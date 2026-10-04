'use strict';

const PAGE = 'audit';
const MAX_LIMIT = 500;
const { badRequest, forbidden, isIsoDate } = require('../http.cjs');
const { writeAudit } = require('../audit.cjs');
const { normalizeSearchText } = require('../db.cjs');
const SEARCH_ALIASES = {
  'bao cao': ['report.'],
  excel: ['report.'],
  xang: ['fuel.'],
  'tinh xang': ['fuel.'],
  phieu: ['entry.'],
  'chi phi': ['entry.', 'fuel.'],
  'gui hang': ['entry.'],
  'nhap chi phi': ['entry.create'],
  cuoc: ['entry.', 'carrier.rate.'],
  misa: ['misa.'],
  'nhan vien': ['employee.'],
  'khach hang': ['customer.'],
  'nha xe': ['carrier.'],
  'nguoi dung': ['user.', 'login', 'logout', 'password.'],
  'tai khoan': ['user.', 'login', 'logout', 'password.'],
  'dang nhap': ['login'],
  'thay doi': [
    'entry.update',
    'user.update',
    'employee.update',
    'customer.update',
    'carrier.update',
    'carrier.rate.update',
    'fuel.price.upsert',
    'settings.update',
    'password.',
  ],
  xoa: [
    'entry.delete',
    'user.delete',
    'employee.delete',
    'customer.delete',
    'carrier.delete',
    'carrier.rate.delete',
    'fuel.price.delete',
    'audit.cleanup',
  ],
  'cai dat': ['settings.'],
};
// action được lưu dưới dạng mã kỹ thuật. Bảng này giúp ô tìm kiếm hiểu đúng
// các cách gọi tiếng Việt quen thuộc mà không buộc người dùng phải biết mã đó.
const ACTION_SEARCH_TEXT = {
  login: 'đăng nhập',
  'login.failed': 'đăng nhập thất bại',
  logout: 'đăng xuất',
  'entry.create': 'tạo phiếu thêm phiếu nhập phiếu cước',
  'entry.update': 'sửa phiếu cập nhật phiếu',
  'entry.delete': 'xóa phiếu',
  'user.create': 'tạo người dùng thêm người dùng tạo tài khoản',
  'user.update': 'sửa người dùng cập nhật người dùng sửa tài khoản',
  'user.reset_password': 'đặt lại mật khẩu',
  'user.delete': 'xóa người dùng xóa tài khoản',
  'password.change': 'đổi mật khẩu',
  'password.initial_change': 'đổi mật khẩu mặc định',
  'password.recover': 'khôi phục mật khẩu',
  'settings.update': 'cập nhật cài đặt',
  'settings.recovery_code_generate': 'tạo mã khôi phục',
  'settings.backup_restore': 'khôi phục sao lưu phục hồi dữ liệu',
  'settings.automatic_backup_restore': 'khôi phục bản sao lưu tự động phục hồi dữ liệu',
  'settings.data_delete': 'xóa dữ liệu dọn dữ liệu',
  'misa.import': 'nhập dữ liệu misa',
  'report.export': 'xuất báo cáo xuất excel',
  'report.carrier_variance.export': 'xuất báo cáo chênh lệch cước',
  'fuel.price.upsert': 'cập nhật giá xăng',
  'fuel.price.delete': 'xóa giá xăng',
  'fuel.record.create': 'lưu tính tiền xăng tạo kỳ tính xăng',
  'fuel.record.update': 'sửa kỳ tính xăng',
  'fuel.record.void': 'hủy kỳ tính xăng',
  'fuel.record.delete': 'xóa kỳ tính xăng',
  'employee.create': 'thêm nhân viên tạo nhân viên',
  'employee.update': 'sửa nhân viên cập nhật nhân viên',
  'employee.delete': 'xóa nhân viên',
  'customer.create': 'thêm khách hàng tạo khách hàng',
  'customer.update': 'sửa khách hàng cập nhật khách hàng',
  'customer.delete': 'xóa khách hàng',
  'customer.import': 'nhập khách hàng',
  'carrier.create': 'thêm nhà xe tạo nhà xe',
  'carrier.update': 'sửa nhà xe cập nhật nhà xe',
  'carrier.delete': 'xóa nhà xe',
  'carrier.excel.import': 'nhập bảng cước nhà xe nhập excel',
  'carrier.rate.create': 'thêm mức cước',
  'carrier.rate.update': 'sửa mức cước',
  'carrier.rate.delete': 'xóa mức cước',
  'carrier.assign_customers': 'gán khách hàng cho nhà xe',
  'carrier.unassign_customer': 'gỡ khách hàng khỏi nhà xe',
  'audit.cleanup': 'dọn nhật ký xóa nhật ký',
};
const normalize = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();

function filters(query) {
  const clauses = [];
  const values = [];
  const q = String(query.q || '')
    .trim()
    .slice(0, 120);
  const from = query.from ? String(query.from) : '';
  const to = query.to ? String(query.to) : '';
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to)) {
    throw badRequest('Khoảng ngày không hợp lệ.');
  }
  if (from) {
    clauses.push('audit_log.at >= ?');
    values.push(new Date(`${from}T00:00:00`).toISOString());
  }
  if (to) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    clauses.push('audit_log.at < ?');
    values.push(end.toISOString());
  }
  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const normalizedQuery = normalize(q);
    const normalizedPattern = `%${normalizedQuery.replace(/[%_\\]/g, '\\$&')}%`;
    const actionPrefixes = Object.entries(SEARCH_ALIASES)
      .filter(([keyword]) => normalizedQuery.includes(keyword))
      .flatMap(([, prefixes]) => prefixes);
    const actions = Object.entries(ACTION_SEARCH_TEXT)
      .filter(([, label]) => normalize(label).includes(normalizedQuery))
      .map(([action]) => action);
    const actionPrefixClauses = actionPrefixes.map(() => 'action LIKE ?');
    const actionClauses = actions.map(() => 'action = ?');
    // Nội dung chi tiết (tên khách, nhà xe…) cũng tìm được, không phân biệt dấu.
    const detailKey = normalizeSearchText(q);
    if (detailKey) {
      actionClauses.push("vn_normalize(COALESCE(audit_log.detail, '')) LIKE ?");
      actions.push(`%${detailKey}%`);
    }
    clauses.push(
      `(audit_log.username LIKE ? ESCAPE '\\' OR vn_normalize(COALESCE(users.full_name, '')) LIKE ? ESCAPE '\\' OR audit_log.action LIKE ? ESCAPE '\\' OR audit_log.entity LIKE ? ESCAPE '\\' OR audit_log.entity_id LIKE ? ESCAPE '\\'${actionPrefixClauses.length ? ` OR ${actionPrefixClauses.join(' OR ')}` : ''}${actionClauses.length ? ` OR ${actionClauses.join(' OR ')}` : ''})`,
    );
    values.push(
      pattern,
      normalizedPattern,
      pattern,
      pattern,
      pattern,
      ...actionPrefixes.map((prefix) => `${prefix}%`),
      ...actions,
    );
  }
  clauses.push("action <> 'login.dev'");
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function parseDetail(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { message: String(value) };
  }
}

function cleanupBefore(value) {
  const date = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest('Vui lòng chọn ngày dọn nhật ký hợp lệ.');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw badRequest('Vui lòng chọn ngày dọn nhật ký hợp lệ.');
  }
  return { date, cutoff: parsed.toISOString() };
}

function register(router) {
  router.get('/api/audit', async (c) => {
    c.requirePage(PAGE);
    const limit = Math.max(1, Math.min(Number(c.query.limit) || 50, MAX_LIMIT));
    const offset = Math.max(0, Number(c.query.offset) || 0);
    const filter = filters(c.query);
    const rows = c.db
      .prepare(
        `SELECT audit_log.id, audit_log.at, audit_log.user_id, audit_log.username,
              audit_log.action, audit_log.entity, audit_log.entity_id, audit_log.detail
           FROM audit_log
           LEFT JOIN users ON users.id = audit_log.user_id
           ${filter.where} ORDER BY audit_log.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...filter.values, limit, offset);
    const total = c.db
      .prepare(
        `SELECT COUNT(*) AS total FROM audit_log
       LEFT JOIN users ON users.id = audit_log.user_id ${filter.where}`,
      )
      .get(...filter.values).total;
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        at: row.at,
        userId: row.user_id,
        username: row.username,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        detail: parseDetail(row.detail),
      })),
    };
  });

  router.post('/api/audit/cleanup', async (c) => {
    c.requirePage(PAGE);
    if (!c.user.is_admin) {
      throw forbidden('Chỉ quản trị viên được dọn nhật ký hoạt động.');
    }
    const { date, cutoff } = cleanupBefore(c.body.beforeDate);
    const deleted = c.db.prepare('DELETE FROM audit_log WHERE at < ?').run(cutoff).changes;
    writeAudit(c.db, c.user, 'audit.cleanup', 'audit_log', null, {
      beforeDate: date,
      deleted,
    });
    return { deleted };
  });
}

module.exports = { register };
