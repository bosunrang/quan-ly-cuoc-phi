import { describe, expect, it } from "vitest";
import type { Entry } from "../src/domain/entries/entry.model";
import {
	emptyEntryInput,
	toEntryInput,
	validateEntry,
} from "../src/domain/entries/entry.model";

const valid = {
	...emptyEntryInput("2026-08-29"),
	customer: "Công ty ABC",
	carrier: "Nhà xe Anh Sáu",
	transportFee: 350_000,
};

describe("kiểm tra phiếu cước", () => {
	it("chấp nhận phiếu hợp lệ", () => {
		expect(validateEntry(valid)).toBeNull();
	});

	it("từ chối ngày sai định dạng", () => {
		expect(validateEntry({ ...valid, entryDate: "29/08/2026" })).toBe(
			"Vui lòng chọn ngày.",
		);
	});

	it("từ chối thiếu khách hàng hoặc nhà xe", () => {
		expect(validateEntry({ ...valid, customer: "   " })).toContain(
			"tên khách hàng",
		);
		expect(validateEntry({ ...valid, carrier: "" })).toContain("nhà xe");
	});

	it("từ chối tiền âm và tiền không nguyên", () => {
		expect(validateEntry({ ...valid, gateFee: -1 })).toBe(
			"Phí cổng không được âm.",
		);
		expect(validateEntry({ ...valid, ticketFee: 1.5 })).toBe(
			"Phí vé phải là số nguyên.",
		);
	});
});

describe("chuyển phiếu sang dữ liệu biểu mẫu", () => {
	it("bỏ các trường do máy chủ quản lý", () => {
		const entry: Entry = {
			id: 7,
			entryDate: "2026-08-29",
			customer: "Công ty ABC",
			carrier: "Nhà xe Anh Sáu",
			recipient: "Chị Lan",
			address: "105 Hàm Nghi",
			spec: "Thùng 20kg",
			ticketFee: 20_000,
			transportFee: 350_000,
			gateFee: 15_000,
			totalFee: 385_000,
			note: "",
			rateVarianceNote: "",
			createdBy: 2,
			createdByName: "Nhân viên A",
			createdAt: "2026-08-29T07:00:00.000Z",
			updatedAt: "2026-08-29T07:00:00.000Z",
		};

		const input = toEntryInput(entry);
		// Không được gửi lên: máy chủ tự quyết người tạo và tổng tiền.
		expect(input).not.toHaveProperty("id");
		expect(input).not.toHaveProperty("createdBy");
		expect(input).not.toHaveProperty("totalFee");
		expect(input.customer).toBe("Công ty ABC");
	});
});
