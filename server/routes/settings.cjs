'use strict';

const { randomBytes } = require('node:crypto');
const { transaction } = require('../db.cjs');
const auth = require('../auth.cjs');
const { writeAudit } = require('../audit.cjs');
const { badRequest } = require('../http.cjs');
const { invalidateDefaultOverview } = require('./misa.cjs');

const PAGE = 'settings';
const MAX_LOGO_LENGTH = 1_500_000;

const BACKUP_TABLES = {
  settings: { table: 'app_settings', columns: ['id', 'company_name', 'company_address', 'display_name', 'tagline', 'logo_data_url', 'updated_at'] },
  misa: { table: 'misa_rows', columns: ['id', 'document_date', 'customer_name', 'address', 'quantity_sold', 'province_city', 'source_key', 'source_file', 'imported_by', 'imported_at', 'product_name', 'document_code', 'customer_key'] },
  customers: { table: 'customers', columns: ['id', 'customer_name', 'carrier', 'recipient', 'address', 'customer_key', 'search_text', 'created_at', 'updated_at'] },
  carriers: { table: 'carriers', columns: ['id', 'name', 'contact', 'phone', 'address', 'is_active', 'carrier_key', 'created_at', 'updated_at', 'schedule', 'note'] },
  carrierCustomers: { table: 'carrier_customers', columns: ['carrier_id', 'customer_id', 'assigned_at'] },
  carrierRates: { table: 'carrier_customer_rates', columns: ['id', 'carrier_id', 'customer_id', 'spec', 'spec_key', 'is_default', 'transport_fee', 'gate_fee', 'note', 'created_at', 'updated_at'] },
  employees: { table: 'employees', columns: ['id', 'full_name', 'user_id', 'is_active', 'search_text', 'created_at', 'updated_at', 'address'] },
  entries: { table: 'entries', columns: ['id', 'entry_date', 'customer', 'carrier', 'recipient', 'address', 'spec', 'ticket_fee', 'transport_fee', 'gate_fee', 'note', 'created_by', 'created_at', 'updated_at', 'misa_document_date', 'misa_document_code', 'employee_id', 'rate_variance_note'] },
  fuelPrices: { table: 'fuel_prices', columns: ['id', 'effective_date', 'fuel_type', 'region', 'price', 'source', 'created_by', 'created_at', 'updated_at'] },
  fuelRecords: { table: 'fuel_records', columns: ['id', 'entry_date', 'employee_id', 'distance_km', 'consumption_liters', 'consumption_base_km', 'fuel_type', 'region', 'fuel_price', 'total_fee', 'note', 'created_by', 'created_at', 'period_from', 'period_to', 'updated_at', 'finalized_at', 'finalized_by', 'voided_at', 'voided_by', 'void_reason', 'status'] },
  routeDistances: { table: 'route_distances', columns: ['id', 'from_name', 'to_name', 'from_key', 'to_key', 'distance_km', 'source', 'updated_at'] },
  fuelLegs: { table: 'fuel_record_legs', columns: ['id', 'fuel_record_id', 'sequence_no', 'from_name', 'to_name', 'distance_km'] },
};

const GROUPS = {
  entries: ['entries'],
  misa: ['misa'],
  customers: ['customers'],
  carriers: ['carriers'],
  employees: ['employees'],
  fuel: ['fuelLegs', 'fuelRecords'],
};

const CLEAR_ORDER = [
  'fuelLegs', 'fuelRecords', 'fuelPrices', 'routeDistances', 'entries',
  'carrierRates', 'carrierCustomers', 'carriers', 'customers', 'misa', 'employees', 'settings',
];

function clearTables(db, names) {
  for (const name of names) db.prepare(`DELETE FROM ${BACKUP_TABLES[name].table}`).run();
}

function rowsForBackup(db) {
  return Object.fromEntries(
    Object.entries(BACKUP_TABLES).map(([key, spec]) => [
      key,
      db.prepare(`SELECT ${spec.columns.join(', ')} FROM ${spec.table}`).all(),
    ]),
  );
}

function importRows(db, name, rows, userId, knownUserIds) {
  if (!Array.isArray(rows)) throw badRequest(`Backup thiếu dữ liệu ${name}.`);
  if (rows.length > 500_000) throw badRequest(`Dữ liệu ${name} quá lớn.`);
  const spec = BACKUP_TABLES[name];
  const placeholders = spec.columns.map(() => '?').join(', ');
  const insert = db.prepare(
    `INSERT INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (${placeholders})`,
  );
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw badRequest(`Dòng dữ liệu ${name} không hợp lệ.`);
    }
    const value = { ...row };
    // Backup từ máy khác vẫn nhập được, không tham chiếu một tài khoản đã không có.
    // Các cột chốt/hủy cũng là khóa ngoại tới users, dù không phải lúc nào cũng có giá trị.
    for (const column of ['created_by', 'imported_by', 'finalized_by', 'voided_by']) {
      if (value[column] != null && !knownUserIds.has(Number(value[column]))) {
        value[column] = userId;
      }
    }
    if (name === 'employees' && value.user_id !== null && !knownUserIds.has(Number(value.user_id))) value.user_id = null;
    // Backup phiên bản 1 trước khi có ghi chú chênh lệch vẫn khôi phục được.
    if (name === 'entries') value.rate_variance_note ??= '';
    if (name === 'fuelRecords') {
      value.updated_at ??= value.created_at ?? new Date().toISOString();
      value.status ??= 'active';
      value.void_reason ??= '';
    }
    // Backup trước v2.0.5 chưa lưu nguồn km vẫn dùng bình thường để tái sử
    // dụng lộ trình; chỉ gắn nhãn phục vụ truy vết.
    if (name === 'routeDistances') value.source ??= 'legacy';
    insert.run(...spec.columns.map((column) => value[column] ?? null));
  }
}

function text(value, field, max) {
  const result = String(value ?? '').trim();
  if (result.length > max) {
    throw badRequest(`${field} không được dài quá ${max} ký tự.`);
  }
  return result;
}

function logo(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value === '/icon.png') return value;
  if (typeof value !== 'string' || value.length > MAX_LOGO_LENGTH) {
    throw badRequest('Logo quá lớn. Vui lòng chọn ảnh nhỏ hơn 1 MB.');
  }
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(value)) {
    throw badRequest('Logo phải là ảnh PNG, JPG hoặc WebP.');
  }
  return value;
}

function toApi(row) {
  return {
    companyName: row.company_name,
    companyAddress: row.company_address,
    displayName: row.display_name,
    tagline: row.tagline,
    logoDataUrl: row.logo_data_url ?? null,
  };
}

function register(router) {
  // Mọi người dùng đã đăng nhập đều đọc được nhận diện chung của ứng dụng.
  router.get('/api/settings', async (c) =>
    toApi(c.db.prepare('SELECT * FROM app_settings WHERE id = 1').get()),
  );

  router.patch('/api/settings', async (c) => {
    c.requirePage(PAGE);
    const settings = {
      companyName: text(c.body.companyName, 'Tên doanh nghiệp', 200),
      companyAddress: text(c.body.companyAddress, 'Địa chỉ', 400),
      displayName: text(c.body.displayName, 'Tên hiển thị', 80),
      tagline: text(c.body.tagline, 'Dòng phụ', 120),
      logoDataUrl: logo(c.body.logoDataUrl),
    };

    return transaction(c.db, () => {
      c.db
        .prepare(
          `UPDATE app_settings SET
             company_name = ?, company_address = ?, display_name = ?,
             tagline = ?, logo_data_url = ?, updated_at = ?
           WHERE id = 1`,
        )
        .run(
          settings.companyName,
          settings.companyAddress,
          settings.displayName,
          settings.tagline,
          settings.logoDataUrl,
          new Date().toISOString(),
        );
      writeAudit(c.db, c.user, 'settings.update', 'settings', 1, {
        ...settings,
        logoDataUrl: settings.logoDataUrl ? '[image]' : null,
      });
      return settings;
    });
  });

  // Mã chỉ hiện đúng một lần để người quản trị cất ở nơi an toàn.
  router.post('/api/settings/recovery-code', async (c) => {
    c.requirePage(PAGE);
    const code = `NAVIVA-${randomBytes(9).toString('base64url')}`;
    const { hash, salt } = auth.hashPassword(code);
    transaction(c.db, () => {
      c.db.prepare(
        `INSERT INTO admin_recovery_code (id, code_hash, code_salt, created_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           code_hash = excluded.code_hash,
           code_salt = excluded.code_salt,
           created_at = excluded.created_at`,
      ).run(hash, salt, new Date().toISOString());
      writeAudit(c.db, c.user, 'settings.recovery_code_generate', 'security', 1);
    });
    return { code };
  });

  router.get('/api/settings/backup', async (c) => {
    c.requirePage(PAGE);
    return {
      format: 'cuocphi-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      data: rowsForBackup(c.db),
    };
  });

  router.post('/api/settings/backup/restore', async (c) => {
    c.requirePage(PAGE);
    const backup = c.body.backup;
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
      throw badRequest('Tệp backup không hợp lệ.');
    }
    if (backup.format !== 'cuocphi-backup' || backup.version !== 1 || !backup.data) {
      throw badRequest('Tệp này không phải backup tương thích của Cước phí.');
    }
    const data = backup.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw badRequest('Dữ liệu backup không hợp lệ.');
    }

    const result = transaction(c.db, () => {
      const knownUserIds = new Set(c.db.prepare('SELECT id FROM users').all().map((row) => Number(row.id)));
      clearTables(c.db, CLEAR_ORDER);
      for (const name of ['settings', 'customers', 'carriers', 'carrierCustomers', 'carrierRates', 'employees', 'misa', 'entries', 'fuelPrices', 'fuelRecords', 'routeDistances', 'fuelLegs']) {
        importRows(c.db, name, data[name], c.user.id, knownUserIds);
      }
      writeAudit(c.db, c.user, 'settings.backup_restore', 'backup', null, {
        createdAt: backup.createdAt ?? null,
      });
      return { restored: true };
    });
    invalidateDefaultOverview(c.db);
    return result;
  });

  router.post('/api/settings/data/delete', async (c) => {
    c.requirePage(PAGE);
    const requested = Array.isArray(c.body.groups) ? c.body.groups : [];
    const selected = requested.includes('all')
      ? Object.keys(GROUPS)
      : [...new Set(requested.filter((name) => Object.hasOwn(GROUPS, name)))];
    if (selected.length === 0) throw badRequest('Hãy chọn ít nhất một nhóm dữ liệu để xóa.');

    const result = transaction(c.db, () => {
      const detachedEmployeeLinks = { entries: 0, fuelRecords: 0 };
      // Xóa cả nhóm nhân viên là yêu cầu dọn dữ liệu có chủ ý. Phiếu và lịch sử
      // xăng vẫn được giữ, nhưng không còn trỏ đến danh mục nhân viên đã xóa.
      if (selected.includes('employees')) {
        detachedEmployeeLinks.entries = Number(
          c.db.prepare('UPDATE entries SET employee_id = NULL WHERE employee_id IS NOT NULL').run().changes,
        );
        detachedEmployeeLinks.fuelRecords = Number(
          c.db.prepare('UPDATE fuel_records SET employee_id = NULL WHERE employee_id IS NOT NULL').run().changes,
        );
      }
      const tables = new Set(selected.flatMap((name) => GROUPS[name]));
      clearTables(c.db, CLEAR_ORDER.filter((name) => tables.has(name)));
      writeAudit(c.db, c.user, 'settings.data_delete', 'data', null, {
        groups: selected,
        detachedEmployeeLinks,
      });
      return { deleted: selected, detachedEmployeeLinks };
    });
    if (selected.includes('misa')) invalidateDefaultOverview(c.db);
    return result;
  });
}

module.exports = { register };
