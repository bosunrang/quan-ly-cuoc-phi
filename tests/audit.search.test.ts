import { describe, expect, it } from "vitest";
import {
	auditDetailRows,
	matchesAuditSearch,
} from "../src/features/audit/AuditPage";

describe("matchesAuditSearch", () => {
	it("tìm theo nhãn hành động tiếng Việt, có hoặc không dấu", () => {
		const row = {
			id: 1,
			at: "2026-09-05T04:00:00.000Z",
			userId: 1,
			username: "admin",
			action: "entry.delete",
			entity: "entry",
			entityId: "2",
			detail: { customer: "Bệnh viện Từ Dũ" },
		};

		expect(matchesAuditSearch(row, "xóa")).toBe(true);
		expect(matchesAuditSearch(row, "xoa phieu")).toBe(true);
		expect(matchesAuditSearch(row, "bệnh viện")).toBe(true);
	});
});

describe("auditDetailRows", () => {
	it("dịch nhãn kỹ thuật của nhật ký nhập liệu sang tiếng Việt", () => {
		expect(
			auditDetailRows({
				carriersCreated: 325,
				carriersUpdated: 0,
				ratesCreated: 557,
			}),
		).toEqual([
			["Nhà xe đã thêm", "325"],
			["Nhà xe đã cập nhật", "0"],
			["Mức cước đã thêm", "557"],
		]);
	});

	it("không để tên trường tiếng Anh chưa biết xuất hiện trên giao diện", () => {
		expect(auditDetailRows({ unknownAuditField: "Giá trị" })).toEqual([
			["Thông tin bổ sung", "Giá trị"],
		]);
	});
});
