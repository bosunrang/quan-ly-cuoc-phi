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

	it("đọc được mẫu Sổ chi tiết bán hàng không có cột địa chỉ", () => {
		const secondTemplateHeaders = [
			"Ngày hạch toán",
			"Số chứng từ",
			"Mã khách hàng",
			"Tên nhóm khách hàng",
			"Tên khách hàng",
			"Mã hàng",
			"Tên hàng",
			"Tổng số lượng bán",
			"Số lô",
		] as Row;
		const result = parseMisaRows("SO_CHI_TIET_BAN_HANG T8.xlsx", [
			["SỔ CHI TIẾT BÁN HÀNG"],
			["Tháng 8 năm 2026"],
			secondTemplateHeaders,
			[
				new Date(2026, 7, 1),
				"PX001/08",
				"26PYBVVIETMY",
				"Phú Yên",
				"Bệnh viện Việt Mỹ Phú Yên",
				"VXABBOTTINFLU",
				"Influvac Tetra 0.5ml",
				30,
				"N10",
			] as Row,
		]);

		expect(result.rows).toEqual([
			expect.objectContaining({
				rowNumber: 4,
				documentDate: "2026-08-01",
				documentCode: "PX001/08",
				customerName: "Bệnh viện Việt Mỹ Phú Yên",
				address: "",
				productName: "Influvac Tetra 0.5ml",
				quantitySold: 30,
				provinceCity: "Phú Yên",
				status: "ready",
			}),
		]);
	});

	it("đọc được mẫu WINBIO có tiêu đề ở dòng thứ tư", () => {
		const winbioHeaders = [
			"Ngày chứng từ",
			"Số chứng từ",
			"Mã khách hàng",
			"Tên khách hàng",
			"Địa chỉ",
			"Mã hàng",
			"Tên hàng",
			"ĐVT",
			"Tổng số lượng bán",
			"Số lô",
			"Tên nhóm khách hàng",
		] as Row;
		const result = parseMisaRows(
			"So_chi_tiet_ban_hang WINBIO tháng 8.2026 mẫu.xlsx",
			[
				[],
				[],
				[],
				winbioHeaders,
				[
					new Date(2026, 7, 1),
					"BH0001/08",
					"19HNTAMAN",
					"Công Ty TNHH Dịch Vụ Y Tế Tâm An",
					"36/99 đường La Thành, Hà Nội",
					"VX-VABIOTECHBC",
					"Vắc xin VA-MENGOC BC",
					"Lọ",
					50,
					"562M",
					"Hà Nam",
				] as Row,
			],
		);

		expect(result.rows).toEqual([
			expect.objectContaining({
				rowNumber: 5,
				documentDate: "2026-08-01",
				documentCode: "BH0001/08",
				customerName: "Công Ty TNHH Dịch Vụ Y Tế Tâm An",
				address: "36/99 đường La Thành, Hà Nội",
				productName: "Vắc xin VA-MENGOC BC",
				quantitySold: 50,
				provinceCity: "Hà Nam",
				status: "ready",
			}),
		]);
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
