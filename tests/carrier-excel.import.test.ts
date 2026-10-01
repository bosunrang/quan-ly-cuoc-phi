import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";
import { wideCarrierRateExport } from "../src/features/carriers/carrier-excel.export";
import {
	parseCarrierRateWorkbook,
	parseCarrierWorkbook,
} from "../src/features/carriers/carrier-excel.import";

function workbookFile(name: string, rows: unknown[][]): File {
	return workbookWithSheets(name, [{ name: "Dữ liệu", rows }]);
}

function workbookWithSheets(
	name: string,
	sheets: Array<{ name: string; rows: unknown[][] }>,
): File {
	const workbook = XLSX.utils.book_new();
	for (const sheet of sheets)
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.aoa_to_sheet(sheet.rows),
			sheet.name,
		);
	const content = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
	return new File([content], name, {
		type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	});
}

describe("nhập Excel nhà xe và bảng cước", () => {
	it("đọc mẫu nhà xe độc lập", async () => {
		const rows = await parseCarrierWorkbook(
			workbookFile("Nhà xe.xlsx", [
				["Nhà xe", "Địa chỉ", "Điểm giao/ Bến xe", "Điện thoại"],
				[
					"6 Quang",
					"1B Bắc Hải, TP Hồ Chí Minh",
					"Bến xe Miền Tây, 395 Kinh Dương Vương",
					"0913.743.300",
				],
			]),
		);

		expect(rows).toEqual([
			{
				rowNumber: 2,
				name: "6 Quang",
				address: "1B Bắc Hải, TP Hồ Chí Minh",
				deliveryPoint: "Bến xe Miền Tây, 395 Kinh Dương Vương",
				phone: "0913.743.300",
				contact: "",
				schedule: "",
				note: "",
				isActive: true,
			},
		]);
	});

	it("tách từng cột quy cách trong mẫu bảng cước dạng ngang", async () => {
		const rows = await parseCarrierRateWorkbook(
			workbookFile("Bảng cước.xlsx", [
				[
					"Nhà xe",
					"Mã khách hàng",
					"Khách hàng",
					"Tất cả",
					"Thùng nhỏ",
					"Thùng trung",
					"Thùng lớn",
					"Hồ sơ",
					"Phí vào cổng",
				],
				["6 Quang", "KH001", "Bệnh viện A", "", 40_000, 50_000, "", "", 5_000],
			]),
		);

		expect(rows).toEqual([
			{
				rowNumber: 2,
				carrierName: "6 Quang",
				customerCode: "KH001",
				customerName: "Bệnh viện A",
				spec: "Thùng nhỏ",
				transportFee: 40_000,
				gateFee: 5_000,
				note: "",
			},
			{
				rowNumber: 2,
				carrierName: "6 Quang",
				customerCode: "KH001",
				customerName: "Bệnh viện A",
				spec: "Thùng trung",
				transportFee: 50_000,
				gateFee: 5_000,
				note: "",
			},
		]);
	});

	it("nhận số lượng quy cách động và cột phí cổng ở cuối", async () => {
		const rows = await parseCarrierRateWorkbook(
			workbookFile("Bảng cước ít quy cách.xlsx", [
				["Nhà xe", "Khách hàng", "Thùng nhỏ", "Hồ sơ lạnh", "Phí cổng"],
				["HCM", "Bệnh viện A", 40_000, 85_000, 7_000],
			]),
		);

		expect(rows).toEqual([
			{
				rowNumber: 2,
				carrierName: "HCM",
				customerName: "Bệnh viện A",
				spec: "Thùng nhỏ",
				transportFee: 40_000,
				gateFee: 7_000,
				note: "",
			},
			{
				rowNumber: 2,
				carrierName: "HCM",
				customerName: "Bệnh viện A",
				spec: "Hồ sơ lạnh",
				transportFee: 85_000,
				gateFee: 7_000,
				note: "",
			},
		]);
	});

	it("coi toàn bộ cột sau khách hàng là quy cách khi file không có phí cổng", async () => {
		const rows = await parseCarrierRateWorkbook(
			workbookFile("bc.xlsx", [
				["Nhà xe", "KHÁCH HÀNG", "Thùng nhỏ", "Thùng trung", "Thùng lớn"],
				["HCM", "Bệnh viện A", null, 100_000, 150_000],
			]),
		);

		expect(
			rows.map(({ spec, transportFee, gateFee }) => ({
				spec,
				transportFee,
				gateFee,
			})),
		).toEqual([
			{ spec: "Thùng trung", transportFee: 100_000, gateFee: 0 },
			{ spec: "Thùng lớn", transportFee: 150_000, gateFee: 0 },
		]);
	});

	it("chọn đúng sheet bảng cước trong file xuất có hai sheet", async () => {
		const file = workbookWithSheets("Bang-cuoc-nha-xe.xlsx", [
			{
				name: "Nhà xe",
				rows: [["Nhà xe", "Địa chỉ", "Điện thoại"]],
			},
			{
				name: "Bảng cước",
				rows: [
					["Nhà xe", "Khách hàng", "Kiện đặc biệt", "Phí vào cổng", "Ghi chú"],
					["6 Quang", "Bệnh viện A", 75_000, 5_000, "Giao gấp"],
				],
			},
		]);

		await expect(parseCarrierRateWorkbook(file)).resolves.toEqual([
			{
				rowNumber: 2,
				carrierName: "6 Quang",
				customerName: "Bệnh viện A",
				spec: "Kiện đặc biệt",
				transportFee: 75_000,
				gateFee: 5_000,
				note: "Giao gấp",
			},
		]);
	});
});

describe("xuất bảng cước nhà xe", () => {
	it("gom các quy cách của cùng nhà xe và khách hàng trên một dòng", () => {
		const result = wideCarrierRateExport([
			{
				carrierName: "6 Quang",
				customerName: "Bệnh viện A",
				spec: "Thùng nhỏ",
				transportFee: 40_000,
				gateFee: 5_000,
				note: "",
			},
			{
				carrierName: "6 Quang",
				customerName: "Bệnh viện A",
				spec: "Kiện đặc biệt",
				transportFee: 75_000,
				gateFee: 5_000,
				note: "",
			},
		]);

		expect(result.specs).toEqual([
			"Tất cả",
			"Thùng nhỏ",
			"Thùng trung",
			"Thùng lớn",
			"Hồ sơ",
			"Kiện đặc biệt",
		]);
		expect(result.rows).toEqual([
			[
				"6 Quang",
				"",
				"Bệnh viện A",
				null,
				40_000,
				null,
				null,
				null,
				75_000,
				5_000,
			],
		]);
	});
});
