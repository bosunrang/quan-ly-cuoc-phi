import { describe, expect, it } from "vitest";
import { auditDetailRows } from "../src/features/audit/AuditPage";

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
