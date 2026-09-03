import type { Row } from "read-excel-file/browser";
import { describe, expect, it } from "vitest";
import { parseMisaRows } from "../src/features/misa/misa.import";

const headers = [
	"Ngày chứng từ",
	"Số chứng từ",
	"Mã khách hàng",
	"Tên khách hàng",
	"Địa chỉ",
	"Mã hàng",
	"Tên hàng",
	"ĐVT",
	"Tổng số lượng bán",
	"Đơn giá",
	"Doanh số bán",
	"Tổng số lượng trả lại",
	"Giá trị trả lại",
	"Giá trị giảm giá",
	"TK giá vốn",
	"TK Có",
	"TK kho",
	"Số lô",
	"Hạn dùng",
	"Mã nhân viên bán hàng",
	"Tỉnh/Thành phố",
];

function row(overrides: Partial<Record<number, unknown>> = {}) {
	const values: unknown[] = Array.from({ length: headers.length }, () => null);
	values[0] = 46174;
	values[1] = "BH26060001";
	values[2] = "KH001";
	values[3] = "Bệnh viện A";
	values[4] = "01 Nguyễn Huệ";
	values[5] = "SP001";
	values[6] = "Mặt hàng A";
	values[8] = 4;
	values[17] = "LO001";
	values[20] = "Hồ Chí Minh";
	for (const [index, value] of Object.entries(overrides)) {
		values[Number(index)] = value;
	}
	return values as Row;
}

describe("đọc file MISA", () => {
	it("tìm đúng dòng tiêu đề và lấy đủ dữ liệu bán hàng", () => {
		const result = parseMisaRows("misa.xlsx", [
			["SỔ CHI TIẾT BÁN HÀNG"],
			["Tháng 6 năm 2026"],
			headers,
			row(),
		]);

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({
			rowNumber: 4,
			documentDate: "2026-06-01",
			customerName: "Bệnh viện A",
			address: "01 Nguyễn Huệ",
			productName: "Mặt hàng A",
			quantitySold: 4,
			provinceCity: "Hồ Chí Minh",
			status: "ready",
		});
	});

	it("đánh dấu bỏ qua khi thiếu trường bắt buộc", () => {
		const result = parseMisaRows("misa.xlsx", [
			headers,
			row({ 0: "không phải ngày" }),
			row({ 3: "" }),
			row({ 6: "" }),
			row({ 8: "" }),
		]);
		expect(result.rows.map((item) => item.status)).toEqual([
			"skipped",
			"skipped",
			"skipped",
			"skipped",
		]);
		expect(result.rows.map((item) => item.reason)).toEqual([
			"Ngày chứng từ không hợp lệ",
			"Thiếu tên khách hàng",
			"Thiếu tên mặt hàng",
			"Số lượng bán không hợp lệ",
		]);
	});

	it("khóa trùng phân biệt khách hàng và sản phẩm", () => {
		const result = parseMisaRows("misa.xlsx", [
			headers,
			row(),
			row({ 3: "Bệnh viện B" }),
			row({ 5: "SP002" }),
		]);
		expect(new Set(result.rows.map((item) => item.sourceKey)).size).toBe(3);
	});
});
