'use strict';

/**
 * Ghi nhật ký. Chỉ thêm, không bao giờ sửa hay xóa.
 * Gọi trong cùng giao dịch với thao tác dữ liệu để hai thứ luôn khớp nhau.
 */
function writeAudit(db, actor, action, entity, entityId, detail) {
  db.prepare(
    `INSERT INTO audit_log (at, user_id, username, action, entity, entity_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    new Date().toISOString(),
    actor?.id ?? null,
    actor?.username ?? '',
    action,
    entity,
    entityId == null ? null : String(entityId),
    detail === undefined ? null : JSON.stringify(detail),
  );
}

module.exports = { writeAudit };
