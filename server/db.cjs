'use strict';

const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

const SCHEMA_VERSION = 40;

/** Chuẩn hóa tiếng Việt để tìm kiếm không phân biệt dấu, hoa/thường và Đ/đ. */
function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Khôi phục chặng từng bị cắt ở giới hạn 100 ký tự từ danh mục địa điểm. */
function restoreTruncatedFuelLocations(db) {
  const locations = db.prepare(`
    SELECT customer_name AS name, address FROM customers
    UNION ALL SELECT name, address FROM carriers
    UNION ALL SELECT full_name AS name, address FROM employees
  `).all();
  const updateFrom = db.prepare(
    'UPDATE fuel_record_legs SET from_name = ? WHERE from_name = ?',
  );
  const updateTo = db.prepare(
    'UPDATE fuel_record_legs SET to_name = ? WHERE to_name = ?',
  );

  for (const location of locations) {
    const name = String(location.name || '').trim();
    const address = String(location.address || '').trim();
    if (!name || !address) continue;
    const full = normalizeSearchText(address).includes(normalizeSearchText(name))
      ? address
      : `${name}, ${address}`;
    if (full.length <= 100) continue;
    const truncated = full.slice(0, 100);
    updateFrom.run(full, truncated);
    updateTo.run(full, truncated);
  }
}

/**
 * Migration chạy tuần tự theo PRAGMA user_version.
 * Quy tắc: đã phát hành thì không sửa, chỉ thêm bước mới vào cuối.
 */
function migrate(db) {
  const row = db.prepare('PRAGMA user_version').get();
  const current = Number(row?.user_version ?? 0);

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Cơ sở dữ liệu phiên bản ${current} mới hơn ứng dụng (${SCHEMA_VERSION}). Hãy cập nhật ứng dụng.`,
    );
  }

  // DDL của SQLite có thể chạy trong transaction. Nhờ đó, nếu một bước nâng
  // cấp lỗi hoặc ứng dụng bị ngắt giữa chừng, user_version và schema cùng
  // quay về trạng thái cũ thay vì để cơ sở dữ liệu dở dang.
  db.exec('BEGIN IMMEDIATE');
  try {

  if (current < 1) {
    db.exec(`
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY,
        username      TEXT    NOT NULL UNIQUE,
        password_hash TEXT    NOT NULL,
        password_salt TEXT    NOT NULL,
        full_name     TEXT    NOT NULL,
        is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin  IN (0, 1)),
        is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      );

      -- Thẻ (màn hình) mà từng người dùng được phép mở.
      CREATE TABLE user_pages (
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_key TEXT    NOT NULL,
        PRIMARY KEY (user_id, page_key)
      );

      -- Chỉ lưu bản băm của token, không lưu token gốc.
      CREATE TABLE sessions (
        token_hash TEXT    PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL,
        expires_at TEXT    NOT NULL
      );
      CREATE INDEX sessions_user_idx ON sessions(user_id);

      -- Phiếu cước. created_by quyết định ai được nhìn thấy dòng này.
      CREATE TABLE entries (
        id             INTEGER PRIMARY KEY,
        entry_date     TEXT    NOT NULL,
        customer       TEXT    NOT NULL DEFAULT '',
        carrier        TEXT    NOT NULL DEFAULT '',
        recipient      TEXT    NOT NULL DEFAULT '',
        address        TEXT    NOT NULL DEFAULT '',
        spec           TEXT    NOT NULL DEFAULT '',
        ticket_fee     INTEGER NOT NULL DEFAULT 0 CHECK (ticket_fee    >= 0),
        transport_fee  INTEGER NOT NULL DEFAULT 0 CHECK (transport_fee >= 0),
        gate_fee       INTEGER NOT NULL DEFAULT 0 CHECK (gate_fee      >= 0),
        total_fee      INTEGER GENERATED ALWAYS AS
                         (ticket_fee + transport_fee + gate_fee) STORED,
        note           TEXT    NOT NULL DEFAULT '',
        created_by     INTEGER NOT NULL REFERENCES users(id),
        created_at     TEXT    NOT NULL,
        updated_at     TEXT    NOT NULL
      );
      CREATE INDEX entries_owner_idx ON entries(created_by, entry_date DESC);
      CREATE INDEX entries_date_idx  ON entries(entry_date DESC);

      -- Nhật ký chỉ ghi thêm, không sửa, không xóa.
      CREATE TABLE audit_log (
        id        INTEGER PRIMARY KEY,
        at        TEXT    NOT NULL,
        user_id   INTEGER,
        username  TEXT    NOT NULL DEFAULT '',
        action    TEXT    NOT NULL,
        entity    TEXT    NOT NULL,
        entity_id TEXT,
        detail    TEXT
      );
      CREATE INDEX audit_at_idx ON audit_log(at DESC);
    `);
  }

  if (current < 2) {
    db.exec(`
      CREATE TABLE app_settings (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        company_name    TEXT NOT NULL DEFAULT '',
        company_address TEXT NOT NULL DEFAULT '',
        display_name    TEXT NOT NULL DEFAULT 'NAVIVA GROUP',
        tagline         TEXT NOT NULL DEFAULT 'Quản lý giao hàng',
        logo_data_url   TEXT,
        updated_at      TEXT NOT NULL
      );

      INSERT INTO app_settings
        (id, company_name, company_address, display_name, tagline, logo_data_url, updated_at)
      VALUES
        (1, '', '', 'NAVIVA GROUP', 'Quản lý giao hàng', '/icon.png', datetime('now'));
    `);
  }

  if (current < 3) {
    db.exec(`
      CREATE TABLE misa_rows (
        id              INTEGER PRIMARY KEY,
        document_date   TEXT    NOT NULL,
        customer_name   TEXT    NOT NULL,
        address         TEXT    NOT NULL DEFAULT '',
        quantity_sold   REAL    NOT NULL,
        province_city   TEXT    NOT NULL DEFAULT '',
        source_key      TEXT    NOT NULL UNIQUE,
        source_file     TEXT    NOT NULL,
        imported_by     INTEGER NOT NULL REFERENCES users(id),
        imported_at     TEXT    NOT NULL
      );
      CREATE INDEX misa_date_idx ON misa_rows(document_date DESC);
      CREATE INDEX misa_customer_idx ON misa_rows(customer_name);
      CREATE INDEX misa_province_idx ON misa_rows(province_city);
    `);
  }

  if (current < 4) {
    db.exec(`
      -- Chỉ mục toàn văn đã bỏ dấu để tìm MISA nhanh khi dữ liệu lớn.
      CREATE VIRTUAL TABLE misa_search USING fts5(
        search_text,
        tokenize = 'unicode61'
      );

      INSERT INTO misa_search(rowid, search_text)
      SELECT id, vn_normalize(customer_name || ' ' || address || ' ' || province_city)
        FROM misa_rows;

      CREATE TRIGGER misa_search_insert AFTER INSERT ON misa_rows BEGIN
        INSERT INTO misa_search(rowid, search_text)
        VALUES (
          new.id,
          vn_normalize(new.customer_name || ' ' || new.address || ' ' || new.province_city)
        );
      END;

      CREATE TRIGGER misa_search_delete AFTER DELETE ON misa_rows BEGIN
        DELETE FROM misa_search WHERE rowid = old.id;
      END;

      CREATE TRIGGER misa_search_update AFTER UPDATE OF customer_name, address, province_city
      ON misa_rows BEGIN
        DELETE FROM misa_search WHERE rowid = old.id;
        INSERT INTO misa_search(rowid, search_text)
        VALUES (
          new.id,
          vn_normalize(new.customer_name || ' ' || new.address || ' ' || new.province_city)
        );
      END;
    `);
  }

  if (current < 5) {
    db.exec(`
      -- Tìm kiếm MISA chỉ theo tên khách hàng.
      DROP TRIGGER misa_search_insert;
      DROP TRIGGER misa_search_delete;
      DROP TRIGGER misa_search_update;

      DELETE FROM misa_search;
      INSERT INTO misa_search(rowid, search_text)
      SELECT id, vn_normalize(customer_name) FROM misa_rows;

      CREATE TRIGGER misa_search_insert AFTER INSERT ON misa_rows BEGIN
        INSERT INTO misa_search(rowid, search_text)
        VALUES (new.id, vn_normalize(new.customer_name));
      END;

      CREATE TRIGGER misa_search_delete AFTER DELETE ON misa_rows BEGIN
        DELETE FROM misa_search WHERE rowid = old.id;
      END;

      CREATE TRIGGER misa_search_update AFTER UPDATE OF customer_name
      ON misa_rows BEGIN
        DELETE FROM misa_search WHERE rowid = old.id;
        INSERT INTO misa_search(rowid, search_text)
        VALUES (new.id, vn_normalize(new.customer_name));
      END;
    `);
  }

  if (current < 6) {
    db.exec(`
      -- Tên mặt hàng từ cột "Tên hàng" trong Sổ chi tiết bán hàng MISA.
      ALTER TABLE misa_rows
      ADD COLUMN product_name TEXT NOT NULL DEFAULT '';
    `);
  }

  if (current < 7) {
    db.exec(`
      -- Danh mục khách hàng: một tên chuẩn có thông tin giao hàng mặc định.
      CREATE TABLE customers (
        id            INTEGER PRIMARY KEY,
        customer_name TEXT    NOT NULL,
        carrier       TEXT    NOT NULL DEFAULT '',
        recipient     TEXT    NOT NULL DEFAULT '',
        address       TEXT    NOT NULL DEFAULT '',
        customer_key  TEXT    NOT NULL UNIQUE,
        search_text   TEXT    NOT NULL,
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      );
      CREATE INDEX customers_search_idx ON customers(search_text);
    `);
  }

  if (current < 8) {
    db.exec(`
      CREATE TABLE carriers (
        id          INTEGER PRIMARY KEY,
        name        TEXT    NOT NULL,
        contact     TEXT    NOT NULL DEFAULT '',
        phone       TEXT    NOT NULL DEFAULT '',
        address     TEXT    NOT NULL DEFAULT '',
        is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        carrier_key TEXT    NOT NULL UNIQUE,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      );
      CREATE INDEX carriers_active_idx ON carriers(is_active, name);

      -- Một khách hàng có thể sử dụng nhiều nhà xe và ngược lại.
      CREATE TABLE carrier_customers (
        carrier_id  INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        assigned_at TEXT    NOT NULL,
        PRIMARY KEY (carrier_id, customer_id)
      );
      CREATE INDEX carrier_customers_customer_idx ON carrier_customers(customer_id);
    `);
  }

  if (current < 9) {
    db.exec(`
      ALTER TABLE carriers ADD COLUMN schedule TEXT NOT NULL DEFAULT '';
      ALTER TABLE carriers ADD COLUMN note TEXT NOT NULL DEFAULT '';
    `);
  }

  if (current < 10) {
    db.exec(`
      CREATE TABLE employees (
        id          INTEGER PRIMARY KEY,
        full_name   TEXT    NOT NULL,
        areas       TEXT    NOT NULL DEFAULT '',
        user_id     INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
        is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        search_text TEXT    NOT NULL,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      );
      CREATE INDEX employees_search_idx ON employees(search_text);
    `);
  }

  if (current < 11) {
    db.exec(`
      -- Phân trang MISA luôn sắp xếp theo ngày và id; chỉ mục ghép giúp
      -- tránh sắp xếp lại toàn bộ khi dữ liệu đã có nhiều tháng.
      CREATE INDEX misa_list_idx
        ON misa_rows(document_date DESC, id DESC);
      CREATE INDEX misa_province_list_idx
        ON misa_rows(province_city, document_date DESC, id DESC);
    `);
  }

  if (current < 12) {
    db.exec(`
      -- Bảng cước thuộc đúng cặp nhà xe - khách hàng. Một cặp có thể có
      -- nhiều quy cách; dòng is_default là mức "Tất cả" dự phòng.
      CREATE TABLE carrier_customer_rates (
        id            INTEGER PRIMARY KEY,
        carrier_id    INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
        customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        spec          TEXT    NOT NULL,
        spec_key      TEXT    NOT NULL,
        is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        transport_fee INTEGER NOT NULL DEFAULT 0 CHECK (transport_fee >= 0),
        gate_fee      INTEGER NOT NULL DEFAULT 0 CHECK (gate_fee >= 0),
        note          TEXT    NOT NULL DEFAULT '',
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL,
        UNIQUE (carrier_id, customer_id, spec_key)
      );
      CREATE INDEX carrier_customer_rates_lookup_idx
        ON carrier_customer_rates(carrier_id, customer_id, is_default, spec_key);
    `);
  }

  if (current < 13) {
    db.exec(`
      -- Số chứng từ phân biệt các đơn bán cùng ngày của một khách hàng.
      -- Các bản ghi cũ dùng chuỗi rỗng, nên vẫn xem được như trước.
      ALTER TABLE misa_rows ADD COLUMN document_code TEXT NOT NULL DEFAULT '';
      CREATE INDEX misa_customer_order_idx
        ON misa_rows(customer_name, document_date DESC, document_code);

      -- Lưu chứng từ MISA đã dùng để tạo phiếu, phục vụ truy vết/báo cáo.
      ALTER TABLE entries ADD COLUMN misa_document_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE entries ADD COLUMN misa_document_code TEXT NOT NULL DEFAULT '';
    `);
  }

  if (current < 14) {
    db.exec(`
      -- Người thao tác và nhân viên chịu cước là hai thông tin riêng.
      ALTER TABLE entries ADD COLUMN employee_id INTEGER REFERENCES employees(id);
      CREATE INDEX entries_employee_idx ON entries(employee_id, entry_date DESC);
      UPDATE entries
         SET employee_id = (SELECT id FROM employees WHERE employees.user_id = entries.created_by)
       WHERE employee_id IS NULL;
    `);
  }

  if (current < 15) {
    db.exec(`
      -- Khóa khách MISA đã chuẩn hóa giúp tra cứu đơn và tỉnh theo khách
      -- không phải chuẩn hóa toàn bộ bảng ở mỗi lần nhập phiếu.
      ALTER TABLE misa_rows ADD COLUMN customer_key TEXT NOT NULL DEFAULT '';
      UPDATE misa_rows SET customer_key = vn_normalize(customer_name)
        WHERE customer_key = '';
      CREATE INDEX misa_customer_key_order_idx
        ON misa_rows(customer_key, document_date DESC, id DESC);
    `);
  }

  if (current < 16) {
    db.exec(`
      CREATE TABLE fuel_prices (
        id INTEGER PRIMARY KEY,
        effective_date TEXT NOT NULL,
        fuel_type TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT 'region1',
        price INTEGER NOT NULL CHECK (price >= 0),
        source TEXT NOT NULL DEFAULT 'Nhập tay',
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(effective_date, fuel_type, region)
      );
      CREATE INDEX fuel_prices_lookup_idx ON fuel_prices(fuel_type, region, effective_date DESC);

      CREATE TABLE fuel_records (
        id INTEGER PRIMARY KEY,
        entry_date TEXT NOT NULL,
        employee_id INTEGER REFERENCES employees(id),
        distance_km REAL NOT NULL CHECK (distance_km >= 0),
        consumption_liters REAL NOT NULL CHECK (consumption_liters >= 0),
        consumption_base_km REAL NOT NULL CHECK (consumption_base_km > 0),
        fuel_type TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT 'region1',
        fuel_price INTEGER NOT NULL CHECK (fuel_price >= 0),
        total_fee INTEGER NOT NULL CHECK (total_fee >= 0),
        note TEXT NOT NULL DEFAULT '',
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX fuel_records_date_idx ON fuel_records(entry_date DESC);
      CREATE INDEX fuel_records_employee_idx ON fuel_records(employee_id, entry_date DESC);
    `);
  }

  if (current < 17) {
    db.exec(`
      ALTER TABLE fuel_records ADD COLUMN period_from TEXT NOT NULL DEFAULT '';
      ALTER TABLE fuel_records ADD COLUMN period_to TEXT NOT NULL DEFAULT '';
      UPDATE fuel_records SET period_from = entry_date, period_to = entry_date
        WHERE period_from = '' OR period_to = '';

      CREATE TABLE route_distances (
        id INTEGER PRIMARY KEY,
        from_name TEXT NOT NULL,
        to_name TEXT NOT NULL,
        from_key TEXT NOT NULL,
        to_key TEXT NOT NULL,
        distance_km REAL NOT NULL CHECK (distance_km >= 0),
        updated_at TEXT NOT NULL,
        UNIQUE(from_key, to_key)
      );
      CREATE INDEX route_distances_search_idx ON route_distances(from_key, to_key);

      CREATE TABLE fuel_record_legs (
        id INTEGER PRIMARY KEY,
        fuel_record_id INTEGER NOT NULL REFERENCES fuel_records(id) ON DELETE CASCADE,
        sequence_no INTEGER NOT NULL,
        from_name TEXT NOT NULL,
        to_name TEXT NOT NULL,
        distance_km REAL NOT NULL CHECK (distance_km >= 0)
      );
      CREATE INDEX fuel_record_legs_record_idx ON fuel_record_legs(fuel_record_id, sequence_no);
    `);
  }

  if (current < 18) {
    db.exec(`
      ALTER TABLE employees ADD COLUMN address TEXT NOT NULL DEFAULT '';
    `);
  }

  if (current < 19) {
    db.exec(`
      UPDATE employees
      SET address = areas
      WHERE trim(address) = '' AND trim(areas) <> '';
      ALTER TABLE employees DROP COLUMN areas;
    `);
  }

  if (current < 20) {
    db.exec(`
      -- Mã dùng một lần để khôi phục tài khoản quản trị viên trên máy chủ cục bộ.
      -- Chỉ lưu bản băm, không bao giờ lưu mã gốc trong SQLite.
      CREATE TABLE admin_recovery_code (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        code_hash   TEXT NOT NULL,
        code_salt   TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
    `);
  }

  if (current < 21) {
    db.exec(`
      -- Chỉ dùng cho tài khoản mặc định khi máy chủ được khởi tạo lần đầu.
      -- Người dùng bắt buộc đổi mật khẩu trước khi thao tác dữ liệu.
      ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
        CHECK (must_change_password IN (0, 1));
    `);
  }

  if (current < 22) {
    db.exec(`
      -- Lý do riêng cho phần chênh lệch cước vận chuyển với bảng giá nhà xe.
      -- Không dùng chung ghi chú hàng hóa/MISA của phiếu.
      ALTER TABLE entries ADD COLUMN rate_variance_note TEXT NOT NULL DEFAULT '';
    `);
  }

  if (current < 23) {
    db.exec(`
      -- Bản ghi xăng được khóa khi đã xuất báo cáo; hủy vẫn giữ lại dấu vết.
      ALTER TABLE fuel_records ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      UPDATE fuel_records SET updated_at = created_at WHERE updated_at = '';
      ALTER TABLE fuel_records ADD COLUMN finalized_at TEXT;
      ALTER TABLE fuel_records ADD COLUMN finalized_by INTEGER REFERENCES users(id);
      ALTER TABLE fuel_records ADD COLUMN voided_at TEXT;
      ALTER TABLE fuel_records ADD COLUMN voided_by INTEGER REFERENCES users(id);
      ALTER TABLE fuel_records ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
      ALTER TABLE fuel_records ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'voided'));
      CREATE INDEX fuel_records_status_idx ON fuel_records(status, period_from, period_to);
    `);
  }

  if (current < 24) {
    db.exec(`
      -- Lưu nguồn km để truy vết. Tất cả các chặng đã lưu vẫn được dùng làm
      -- dữ liệu lộ trình, kể cả chặng người dùng đã hiệu chỉnh thủ công.
      ALTER TABLE route_distances ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy';
      CREATE INDEX route_distances_source_idx ON route_distances(source, updated_at DESC);
    `);
  }

  if (current < 25) {
    db.exec(`
      -- Mã khách hàng từ file MISA được lưu riêng để xem và đối soát.
      -- Các dòng đã nhập trước đây không có mã vẫn giữ nguyên giá trị rỗng.
      ALTER TABLE misa_rows ADD COLUMN customer_code TEXT NOT NULL DEFAULT '';
      CREATE INDEX misa_customer_code_idx ON misa_rows(customer_code);
    `);
  }

  if (current < 26) {
    db.exec(`
      -- Trạng thái hóa đơn được lưu riêng để ghép rõ ràng vào ghi chú báo cáo.
      ALTER TABLE entries ADD COLUMN bill_status TEXT NOT NULL DEFAULT ''
        CHECK (bill_status IN ('', 'Có bill', 'Không bill'));
    `);
  }

  if (current < 27) {
    restoreTruncatedFuelLocations(db);
  }

  if (current < 28) {
    db.exec(`
      -- Mã khách hàng dùng chung cho danh mục, nhập Excel và chọn phiếu cước.
      ALTER TABLE customers ADD COLUMN customer_code TEXT NOT NULL DEFAULT '';
      CREATE INDEX customers_customer_code_idx ON customers(customer_code);
      UPDATE customers
      SET customer_code = COALESCE((
        SELECT customer_code FROM misa_rows
         WHERE misa_rows.customer_key = customers.customer_key
           AND customer_code <> ''
         ORDER BY document_date DESC, id DESC LIMIT 1
      ), '')
      WHERE customer_code = '';
      UPDATE customers
      SET search_text = vn_normalize(
        customer_name || ' ' || customer_code || ' ' || carrier || ' ' || recipient || ' ' || address
      );
    `);
  }

  if (current < 29) {
    db.exec(`
      -- Lý do giữ lại phiếu có cùng ngày, khách hàng và danh sách mặt hàng.
      ALTER TABLE entries ADD COLUMN duplicate_reason TEXT NOT NULL DEFAULT '';
    `);
  }

  if (current < 30) {
    db.exec(`
      -- Phương tiện được chốt theo từng lần tính, độc lập với định mức đang
      -- được chọn trên giao diện ở thời điểm xem lại lịch sử.
      ALTER TABLE fuel_records ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT ''
        CHECK (vehicle_type IN ('', 'motorcycle', 'truck'));
    `);
  }

  if (current < 31) {
    db.exec(`
      -- Định mức là cấu hình chung trên máy chủ; máy trạm chỉ đọc để tính.
      ALTER TABLE app_settings ADD COLUMN motorcycle_consumption_liters REAL NOT NULL DEFAULT 1;
      ALTER TABLE app_settings ADD COLUMN motorcycle_base_km REAL NOT NULL DEFAULT 40;
      ALTER TABLE app_settings ADD COLUMN truck_consumption_liters REAL NOT NULL DEFAULT 7.5;
      ALTER TABLE app_settings ADD COLUMN truck_base_km REAL NOT NULL DEFAULT 100;
    `);
  }

  if (current < 32) {
    db.exec(`
      -- Ghi chú tự do của phiếu, tách riêng với danh sách sản phẩm MISA.
      ALTER TABLE entries ADD COLUMN general_note TEXT NOT NULL DEFAULT '';
    `);
  }

  if (current < 33) {
    // Quy tắc duy nhất được bật sau migration. Không tự động sửa,
    // gộp hay xóa dữ liệu khách hàng hiện có.
  }

  if (current < 34) {
    db.exec(`
      -- Form nhập phiếu đối chiếu mã khách hàng không phân biệt hoa/thường.
      -- Chỉ mục phải dùng cùng COLLATE NOCASE với truy vấn; nếu không SQLite
      -- sẽ quét toàn bộ dữ liệu MISA cho từng khách hàng trong danh mục.
      CREATE INDEX misa_customer_code_nocase_order_idx
        ON misa_rows(customer_code COLLATE NOCASE, document_date DESC, id DESC);
    `);
  }

  if (current < 35) {
    db.exec(`
      -- Nhiều nhà xe có thể nhận hàng tại cùng một bến/điểm giao. Giá trị này
      -- được dùng để gộp chặng xăng, còn địa chỉ nhà xe vẫn phục vụ liên hệ.
      ALTER TABLE carriers ADD COLUMN delivery_point TEXT NOT NULL DEFAULT '';
    `);
  }

  if (current < 36) {
    db.exec(`
      -- Khoản phát sinh riêng của từng phiếu giao hàng; tổng hiển thị được
      -- tính kèm khoản này tại tầng nghiệp vụ để vẫn tương thích dữ liệu cũ.
      ALTER TABLE entries ADD COLUMN other_fee INTEGER NOT NULL DEFAULT 0
        CHECK (other_fee >= 0);
    `);
  }

  if (current < 37) {
    db.exec(`
      ALTER TABLE entries ADD COLUMN other_fee_name TEXT NOT NULL DEFAULT '';
    `);
  }

	if (current < 38) {
    db.exec(`
      -- Các khoản phát sinh ngoài tiền xăng của một kỳ tính.
      ALTER TABLE fuel_records ADD COLUMN extra_costs TEXT NOT NULL DEFAULT '[]';
    `);
	}

	if (current < 39) {
		db.exec(`
		  -- Người nhận không còn là thuộc tính danh mục khách hàng. Giữ cột cũ
		  -- để bảo toàn dữ liệu lịch sử, nhưng loại khỏi chỉ mục tìm kiếm mới.
		  UPDATE customers
		  SET search_text = vn_normalize(
		    customer_name || ' ' || customer_code || ' ' || carrier || ' ' || address
		  );
		`);
	}

  if (current < 40) {
    db.exec(`
      -- Khóa chuẩn hóa của khách hàng, nhà xe và quy cách được lưu sẵn trên
      -- phiếu. Trước đây mỗi truy vấn báo cáo gọi vn_normalize() (hàm JS) cho
      -- từng phiếu, làm Tổng quan/báo cáo chậm dần theo số phiếu.
      ALTER TABLE entries ADD COLUMN customer_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE entries ADD COLUMN carrier_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE entries ADD COLUMN spec_key TEXT NOT NULL DEFAULT '';
      UPDATE entries SET
        customer_key = vn_normalize(customer),
        carrier_key = vn_normalize(carrier),
        spec_key = vn_normalize(spec);

      -- Mọi đường ghi (form, khôi phục backup) đều tự có khóa đúng.
      CREATE TRIGGER entries_keys_insert AFTER INSERT ON entries BEGIN
        UPDATE entries SET
          customer_key = vn_normalize(new.customer),
          carrier_key = vn_normalize(new.carrier),
          spec_key = vn_normalize(new.spec)
        WHERE id = new.id;
      END;

      -- Chỉ tính lại khi chữ thật sự đổi, để khóa đã được nối theo danh mục
      -- (sau khi đổi tên khách hàng/nhà xe) không bị trả về tên cũ khi sửa phiếu.
      CREATE TRIGGER entries_keys_update AFTER UPDATE OF customer, carrier, spec ON entries BEGIN
        UPDATE entries SET
          customer_key = CASE WHEN old.customer IS new.customer
            THEN customer_key ELSE vn_normalize(new.customer) END,
          carrier_key = CASE WHEN old.carrier IS new.carrier
            THEN carrier_key ELSE vn_normalize(new.carrier) END,
          spec_key = CASE WHEN old.spec IS new.spec
            THEN spec_key ELSE vn_normalize(new.spec) END
        WHERE id = new.id;
      END;

      -- Đổi tên trong danh mục thì phiếu cũ vẫn nối được với bảng cước,
      -- báo cáo chênh lệch và tỉnh/thành; chữ in trên phiếu giữ nguyên lịch sử.
      CREATE TRIGGER customers_rename_entries AFTER UPDATE OF customer_key ON customers
      WHEN old.customer_key IS NOT new.customer_key BEGIN
        UPDATE entries SET customer_key = new.customer_key
         WHERE customer_key = old.customer_key;
      END;
      CREATE TRIGGER carriers_rename_entries AFTER UPDATE OF carrier_key ON carriers
      WHEN old.carrier_key IS NOT new.carrier_key BEGIN
        UPDATE entries SET carrier_key = new.carrier_key
         WHERE carrier_key = old.carrier_key;
      END;

      CREATE INDEX entries_customer_key_idx ON entries(customer_key, entry_date);
      CREATE INDEX entries_carrier_key_idx ON entries(carrier_key);

      -- Danh sách phiếu sắp xếp theo ngày rồi id; chỉ mục ghép bỏ được bước
      -- sắp xếp tạm và thay thế hoàn toàn chỉ mục chỉ theo ngày.
      CREATE INDEX entries_list_idx ON entries(entry_date DESC, id DESC);
      DROP INDEX entries_date_idx;

      -- Chỉ mục MISA trùng lặp: đã có chỉ mục ghép bắt đầu bằng cùng cột.
      DROP INDEX misa_date_idx;
      DROP INDEX misa_province_idx;
      DROP INDEX misa_customer_idx;
    `);
  }

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function ensureCustomerCodeUniqueIndex(db) {
  const duplicate = db.prepare(
    `SELECT 1
       FROM customers
      WHERE trim(customer_code) <> ''
      GROUP BY trim(customer_code) COLLATE NOCASE
     HAVING COUNT(*) > 1
      LIMIT 1`,
  ).get();
  if (duplicate) return false;
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS customers_customer_code_unique_idx
      ON customers(customer_code COLLATE NOCASE)
      WHERE customer_code <> '';
  `);
  return true;
}

function openDatabase(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.function('vn_normalize', { deterministic: true }, normalizeSearchText);
  // WAL cho phép đọc trong lúc đang ghi — cần thiết khi nhiều máy dùng chung.
  db.exec(
    // journal_size_limit: sau lần ghi lớn (nhập MISA, khôi phục backup) file WAL
    // được cắt về tối đa 16 MB thay vì giữ nguyên kích thước đỉnh. cache_size 32 MB
    // giúp nhập MISA/khôi phục backup lớn không phải ghi tràn bộ đệm liên tục.
    'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA journal_size_limit = 16777216; PRAGMA cache_size = -32768;',
  );
  migrate(db);
  ensureCustomerCodeUniqueIndex(db);
  return db;
}

/** Chạy nhiều câu lệnh trong một giao dịch; lỗi thì hoàn tác toàn bộ. */
function transaction(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  openDatabase,
  transaction,
  normalizeSearchText,
  SCHEMA_VERSION,
};
