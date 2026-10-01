import readExcelFile, { type Row } from "read-excel-file/browser";
import type {
	CarrierExcelCarrierInput,
	CarrierExcelRateInput,
} from "../../domain/carriers/carrier.model";
import { normalizeText } from "../../shared/lib/text";
import { canonicalCarrierRateSpec } from "./carrier-rate-specs";

const CARRIER_HEADERS = ["nha xe", "chanh xe", "ten chanh xe"];
const CUSTOMER_HEADERS = ["don vi", "ten kh", "ten khach hang", "khach hang"];
const CUSTOMER_CODE_HEADERS = ["ma khach hang", "ma kh"];
const GATE_FEE_HEADERS = ["phi vao cong", "phi cong"];

const clean = (value: unknown) => String(value ?? "").trim();
const aliases = (value: unknown, names: string[]) =>
	names.includes(normalizeText(value));

function headerIndex(rows: Row[], required: string[][]): number {
	return rows.findIndex((row) =>
		required.every((names) => row.some((cell) => aliases(cell, names))),
	);
}

function indexOf(header: Row, names: string[]): number {
	return header.findIndex((cell) => aliases(cell, names));
}

function money(value: unknown): number {
	if (typeof value === "number")
		return Number.isFinite(value) ? Math.round(value) : 0;
	const digits = clean(value).replace(/[^0-9-]/g, "");
	return digits ? Number(digits) : 0;
}

function hasValue(value: unknown): boolean {
	return clean(value) !== "";
}

function active(value: unknown): boolean {
	return !["0", "khong", "không", "ngung", "ngừng"].includes(
		normalizeText(value),
	);
}

function nonEmptyRows(rows: Row[], headerAt: number) {
	return rows
		.slice(headerAt + 1)
		.map((row, index) => ({ row, rowNumber: headerAt + index + 2 }))
		.filter(({ row }) => row.some(hasValue));
}

function parseCarrierRows(rows: Row[]): CarrierExcelCarrierInput[] {
	const headerAt = headerIndex(rows, [CARRIER_HEADERS]);
	if (headerAt < 0)
		throw new Error("Không tìm thấy cột “Nhà xe” trong file nhà xe.");
	const header = rows[headerAt];
	const name = indexOf(header, CARRIER_HEADERS);
	const address = indexOf(header, ["dia chi"]);
	const deliveryPoint = indexOf(header, [
		"diem giao",
		"ben xe",
		"diem giao ben xe",
	]);
	const phone = indexOf(header, ["dien thoai", "so dien thoai"]);
	const schedule = indexOf(header, ["gio xe chay", "gio nhan hang"]);
	const note = indexOf(header, ["ghi chu"]);
	const isActive = indexOf(header, ["trang thai", "hoat dong"]);
	return nonEmptyRows(rows, headerAt).map(({ row, rowNumber }) => ({
		rowNumber,
		name: clean(row[name]),
		contact: "",
		address: address < 0 ? "" : clean(row[address]),
		deliveryPoint: deliveryPoint < 0 ? "" : clean(row[deliveryPoint]),
		phone: phone < 0 ? "" : clean(row[phone]),
		schedule: schedule < 0 ? "" : clean(row[schedule]),
		note: note < 0 ? "" : clean(row[note]),
		isActive: isActive < 0 || active(row[isActive]),
	}));
}

function parseNarrowRateRows(
	rows: Row[],
	headerAt: number,
): CarrierExcelRateInput[] {
	const header = rows[headerAt];
	const carrierName = indexOf(header, CARRIER_HEADERS);
	const customerCode = indexOf(header, CUSTOMER_CODE_HEADERS);
	const customerName = indexOf(header, CUSTOMER_HEADERS);
	const spec = indexOf(header, ["quy cach"]);
	const transportFee = indexOf(header, [
		"cuoc van chuyen",
		"gia cuoc",
		"cuoc phi",
	]);
	const gateFee = indexOf(header, GATE_FEE_HEADERS);
	const note = indexOf(header, ["ghi chu"]);
	return nonEmptyRows(rows, headerAt).map(({ row, rowNumber }) => ({
		rowNumber,
		carrierName: clean(row[carrierName]),
		...(customerCode < 0 ? {} : { customerCode: clean(row[customerCode]) }),
		customerName: customerName < 0 ? "" : clean(row[customerName]),
		spec: clean(row[spec]),
		transportFee: transportFee < 0 ? 0 : money(row[transportFee]),
		gateFee: gateFee < 0 ? 0 : money(row[gateFee]),
		note: note < 0 ? "" : clean(row[note]),
	}));
}

function parseWideRateRows(
	rows: Row[],
	headerAt: number,
): CarrierExcelRateInput[] {
	const header = rows[headerAt];
	const carrierName = indexOf(header, CARRIER_HEADERS);
	const customerCode = indexOf(header, CUSTOMER_CODE_HEADERS);
	const customerName = indexOf(header, CUSTOMER_HEADERS);
	const gateFee = indexOf(header, GATE_FEE_HEADERS);
	const note = indexOf(header, ["ghi chu"]);
	// Hai cột nhận diện đứng trước; các cột có tên tiếp theo là quy cách động.
	// Nếu có cột Phí cổng, phần quy cách kết thúc ngay trước cột đó.
	const firstRateColumn = Math.max(carrierName, customerCode, customerName) + 1;
	const rateColumnEnd = gateFee >= 0 ? gateFee : header.length;
	const rateColumns = header
		.map((value, index) => ({
			index,
			spec: canonicalCarrierRateSpec(value),
		}))
		.filter(
			(column) =>
				column.index >= firstRateColumn &&
				column.index < rateColumnEnd &&
				column.index !== note &&
				column.spec !== "",
		);

	return nonEmptyRows(rows, headerAt).flatMap(({ row, rowNumber }) => {
		const common = {
			rowNumber,
			carrierName: clean(row[carrierName]),
			...(customerCode < 0 ? {} : { customerCode: clean(row[customerCode]) }),
			customerName: customerName < 0 ? "" : clean(row[customerName]),
			gateFee: gateFee < 0 ? 0 : money(row[gateFee]),
			note: note < 0 ? "" : clean(row[note]),
		};
		const transportRows = rateColumns
			.filter((column) => hasValue(row[column.index]))
			.map((column) => ({
				...common,
				spec: column.spec,
				transportFee: money(row[column.index]),
			}));
		if (transportRows.length || gateFee < 0 || !hasValue(row[gateFee]))
			return transportRows;
		return [
			{
				...common,
				spec: "Tất cả",
				transportFee: 0,
			},
		];
	});
}

function parseRateRows(rows: Row[]): CarrierExcelRateInput[] {
	const headerAt = rows.findIndex(
		(row) =>
			row.some((cell) => aliases(cell, CARRIER_HEADERS)) &&
			(row.some((cell) => aliases(cell, CUSTOMER_HEADERS)) ||
				row.some((cell) => aliases(cell, CUSTOMER_CODE_HEADERS))),
	);
	if (headerAt < 0)
		throw new Error(
			"Không tìm thấy cột “Nhà xe” và “Mã khách hàng” hoặc “Khách hàng” trong file bảng cước.",
		);
	return indexOf(rows[headerAt], ["quy cach"]) >= 0
		? parseNarrowRateRows(rows, headerAt)
		: parseWideRateRows(rows, headerAt);
}

async function sheetRows(file: File, preferredNames: string[]): Promise<Row[]> {
	const sheets = await readExcelFile(file);
	if (!sheets.length) throw new Error("File Excel không có sheet dữ liệu.");
	return (
		sheets.find((sheet) =>
			preferredNames.includes(normalizeText(sheet.sheet)),
		) ?? sheets[0]
	).data;
}

export async function parseCarrierWorkbook(
	file: File,
): Promise<CarrierExcelCarrierInput[]> {
	return parseCarrierRows(await sheetRows(file, ["nha xe", "chanh xe"]));
}

export async function parseCarrierRateWorkbook(
	file: File,
): Promise<CarrierExcelRateInput[]> {
	return parseRateRows(await sheetRows(file, ["bang cuoc", "cuoc nha xe"]));
}
