// Chỉ dùng kiểu dữ liệu: việc đọc file chạy trong misa.worker.ts.
import type { Row, SheetData } from "read-excel-file/web-worker";
import type {
	MisaImportRow,
	MisaParsedFile,
} from "../../domain/misa/misa.model";

const HEADER_ALIASES = {
	documentDate: ["ngay chung tu", "ngay hach toan", "ngay"],
	documentNumber: ["so chung tu", "so hoa don", "so phieu", "chung tu"],
	customerCode: ["ma khach hang"],
	customerName: ["ten khach hang", "khach hang"],
	address: ["dia chi"],
	productCode: ["ma hang", "ma san pham"],
	productName: ["ten hang", "ten mat hang"],
	quantitySold: ["tong so luong ban", "so luong ban", "so luong"],
	lotNumber: ["so lo"],
	provinceCity: [
		"tinh/thanh pho",
		"tinh thanh pho",
		"tinh/thanh",
		"ten nhom khach hang",
	],
};

interface ColumnMap {
	documentDate: number;
	documentNumber: number;
	customerCode: number;
	customerName: number;
	address: number;
	productCode: number;
	productName: number;
	quantitySold: number;
	lotNumber: number;
	provinceCity: number;
}

function normalizeText(value: unknown): string {
	return String(value ?? "").trim();
}

/**
 * Khác normalizeText dùng chung ở chỗ giữ dấu "/" (tiêu đề như "Tỉnh/Thành phố").
 * Không gộp với hàm chung: khóa nguồn (sourceKey) của các dòng MISA đã lưu được
 * tạo bằng hàm này, đổi cách chuẩn hóa sẽ làm hỏng việc phát hiện dòng trùng.
 */
function normalizeVietnamese(value: unknown): string {
	return normalizeText(value)
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D")
		.toLowerCase()
		.replace(/[^a-z0-9/]+/g, " ")
		.trim();
}

function findColumn(headers: Row, aliases: string[]): number {
	const normalized = aliases.map(normalizeVietnamese);
	return headers.findIndex((header) =>
		normalized.includes(normalizeVietnamese(header)),
	);
}

function resolveColumns(headers: Row): ColumnMap {
	return {
		documentDate: findColumn(headers, HEADER_ALIASES.documentDate),
		documentNumber: findColumn(headers, HEADER_ALIASES.documentNumber),
		customerCode: findColumn(headers, HEADER_ALIASES.customerCode),
		customerName: findColumn(headers, HEADER_ALIASES.customerName),
		address: findColumn(headers, HEADER_ALIASES.address),
		productCode: findColumn(headers, HEADER_ALIASES.productCode),
		productName: findColumn(headers, HEADER_ALIASES.productName),
		quantitySold: findColumn(headers, HEADER_ALIASES.quantitySold),
		lotNumber: findColumn(headers, HEADER_ALIASES.lotNumber),
		provinceCity: findColumn(headers, HEADER_ALIASES.provinceCity),
	};
}

function findHeaders(sheet: SheetData): {
	dataStartIndex: number;
	columns: ColumnMap;
} {
	for (let index = 0; index < Math.min(sheet.length, 15); index += 1) {
		const columns = resolveColumns(sheet[index] ?? []);
		if (
			columns.documentDate >= 0 &&
			columns.customerName >= 0 &&
			columns.productName >= 0 &&
			columns.quantitySold >= 0 &&
			columns.provinceCity >= 0
		) {
			return { dataStartIndex: index + 1, columns };
		}
	}
	throw new Error(
		"Không nhận ra cấu trúc file. Cần có các cột Ngày chứng từ, Tên khách hàng, Tên hàng, Tổng số lượng bán và Tỉnh/Thành phố.",
	);
}

function isoDate(year: number, month: number, day: number): string | null {
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return date.toISOString().slice(0, 10);
}

function cellDate(value: unknown): string | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		const epoch = Date.UTC(1899, 11, 30);
		return new Date(epoch + Math.floor(value) * 86_400_000)
			.toISOString()
			.slice(0, 10);
	}
	const text = normalizeText(value);
	let match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
	if (match)
		return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
	match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
	if (match)
		return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
	return null;
}

function cellNumber(value: unknown): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	const text = normalizeText(value).replace(/\s/g, "");
	if (!text) return null;
	const normalized = text.includes(",")
		? text.replace(/\./g, "").replace(",", ".")
		: text.replace(/,/g, "");
	const number = Number(normalized);
	return Number.isFinite(number) ? number : null;
}

function optionalCell(row: Row, column: number): unknown {
	return column >= 0 ? row[column] : undefined;
}

function sourceKey(
	row: Row,
	columns: ColumnMap,
	date: string,
	quantity: number,
) {
	return [
		date,
		normalizeVietnamese(optionalCell(row, columns.documentNumber)),
		normalizeVietnamese(optionalCell(row, columns.customerCode)),
		normalizeVietnamese(row[columns.customerName]),
		normalizeVietnamese(optionalCell(row, columns.address)),
		normalizeVietnamese(optionalCell(row, columns.productCode)),
		normalizeVietnamese(optionalCell(row, columns.lotNumber)),
		String(quantity),
	].join("|");
}

export function parseMisaRows(
	fileName: string,
	sheet: SheetData,
): MisaParsedFile {
	const { dataStartIndex, columns } = findHeaders(sheet);
	const rows: MisaImportRow[] = [];

	for (const [offset, source] of sheet.slice(dataStartIndex).entries()) {
		const customerName = normalizeText(source[columns.customerName]);
		const address = normalizeText(optionalCell(source, columns.address));
		const productName = normalizeText(source[columns.productName]);
		const provinceCity = normalizeText(source[columns.provinceCity]);
		const rawDate = source[columns.documentDate];
		const rawQuantity = source[columns.quantitySold];
		const hasData = [
			customerName,
			address,
			productName,
			provinceCity,
			rawDate,
			rawQuantity,
		].some((value) => normalizeText(value) !== "");
		if (!hasData) continue;

		const documentDate = cellDate(rawDate);
		const quantitySold = cellNumber(rawQuantity);
		let reason = "";
		if (!documentDate) reason = "Ngày chứng từ không hợp lệ";
		else if (!customerName) reason = "Thiếu tên khách hàng";
		else if (!productName) reason = "Thiếu tên mặt hàng";
		else if (quantitySold === null) reason = "Số lượng bán không hợp lệ";

		rows.push({
			rowNumber: dataStartIndex + offset + 1,
			documentDate: documentDate ?? "",
			documentCode: normalizeText(optionalCell(source, columns.documentNumber)),
			customerCode: normalizeText(optionalCell(source, columns.customerCode)),
			customerName,
			address,
			productName,
			quantitySold,
			provinceCity,
			sourceKey:
				documentDate && quantitySold !== null
					? sourceKey(source, columns, documentDate, quantitySold)
					: `invalid:${dataStartIndex + offset + 1}`,
			status: reason ? "skipped" : "ready",
			reason,
		});
	}

	if (!rows.length)
		throw new Error("Không tìm thấy dòng dữ liệu nào trong file.");
	return { fileName, rows };
}
