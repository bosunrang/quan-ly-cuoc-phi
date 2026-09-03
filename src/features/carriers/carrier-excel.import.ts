import readExcelFile, { type Row } from "read-excel-file/browser";
import type {
	CarrierExcelCarrierInput,
	CarrierExcelRateInput,
} from "../../domain/carriers/carrier.model";
import { normalizeText } from "../../shared/lib/text";

export interface CarrierExcelPayload {
	carriers: CarrierExcelCarrierInput[];
	rates: CarrierExcelRateInput[];
}

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

function active(value: unknown): boolean {
	return !["0", "khong", "không", "ngung", "ngừng"].includes(
		normalizeText(value),
	);
}

function carrierRows(rows: Row[]): CarrierExcelCarrierInput[] {
	const headerAt = headerIndex(rows, [["nha xe", "chanh xe", "ten chanh xe"]]);
	if (headerAt < 0) return [];
	const header = rows[headerAt];
	const name = indexOf(header, ["nha xe", "chanh xe", "ten chanh xe"]);
	const address = indexOf(header, ["dia chi"]);
	const phone = indexOf(header, ["dien thoai", "so dien thoai"]);
	const schedule = indexOf(header, ["gio xe chay", "gio nhan hang"]);
	const note = indexOf(header, ["ghi chu"]);
	const isActive = indexOf(header, ["trang thai", "hoat dong"]);
	return rows.slice(headerAt + 1).map((row, index) => ({
		rowNumber: headerAt + index + 2,
		name: clean(row[name]),
		contact: "",
		address: address < 0 ? "" : clean(row[address]),
		phone: phone < 0 ? "" : clean(row[phone]),
		schedule: schedule < 0 ? "" : clean(row[schedule]),
		note: note < 0 ? "" : clean(row[note]),
		isActive: isActive < 0 || active(row[isActive]),
	}));
}

function rateRows(rows: Row[]): CarrierExcelRateInput[] {
	const headerAt = headerIndex(rows, [
		["nha xe", "chanh xe", "ten chanh xe"],
		["don vi", "ten kh", "ten khach hang", "khach hang"],
		["quy cach"],
	]);
	if (headerAt < 0) return [];
	const header = rows[headerAt];
	const carrierName = indexOf(header, ["nha xe", "chanh xe", "ten chanh xe"]);
	const customerName = indexOf(header, [
		"don vi",
		"ten kh",
		"ten khach hang",
		"khach hang",
	]);
	const spec = indexOf(header, ["quy cach"]);
	const transportFee = indexOf(header, [
		"cuoc van chuyen",
		"gia cuoc",
		"cuoc phi",
	]);
	const gateFee = indexOf(header, ["phi vao cong", "phi cong"]);
	const note = indexOf(header, ["ghi chu"]);
	return rows.slice(headerAt + 1).map((row, index) => ({
		rowNumber: headerAt + index + 2,
		carrierName: clean(row[carrierName]),
		customerName: clean(row[customerName]),
		spec: clean(row[spec]),
		transportFee: transportFee < 0 ? 0 : money(row[transportFee]),
		gateFee: gateFee < 0 ? 0 : money(row[gateFee]),
		note: note < 0 ? "" : clean(row[note]),
	}));
}

export async function parseCarrierExcelWorkbook(
	file: File,
): Promise<CarrierExcelPayload> {
	const sheets = await readExcelFile(file);
	const carriers: CarrierExcelCarrierInput[] = [];
	const rates: CarrierExcelRateInput[] = [];
	for (const sheet of sheets) {
		const nextRates = rateRows(sheet.data);
		if (nextRates.length) rates.push(...nextRates);
		else carriers.push(...carrierRows(sheet.data));
	}
	if (!carriers.length && !rates.length) {
		throw new Error(
			"Không tìm thấy sheet Nhà xe hoặc Bảng cước với các cột đúng mẫu.",
		);
	}
	return { carriers, rates };
}
