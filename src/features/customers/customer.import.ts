import { type Row, readSheet } from "read-excel-file/browser";
import type {
	CustomerImportKeys,
	CustomerInput,
} from "../../domain/customers/customer.model";
import { normalizeText } from "../../shared/lib/text";

export type CustomerImportStatus = "ready" | "update" | "duplicate" | "skipped";

export interface CustomerImportRow extends CustomerInput {
	rowNumber: number;
	status: CustomerImportStatus;
	reason?: string;
}

export interface CustomerImportPreview {
	totalRows: number;
	readyCount: number;
	updateCount: number;
	duplicateCount: number;
	skippedCount: number;
	rows: CustomerImportRow[];
}

function clean(value: unknown): string {
	return String(value ?? "").trim();
}

function indexOf(headers: Row, aliases: string[]): number {
	return headers.findIndex((header) => aliases.includes(normalizeText(header)));
}

export async function parseCustomerWorkbook(
	file: File,
	existingKeys: CustomerImportKeys,
): Promise<CustomerImportPreview> {
	const sheet = await readSheet(file);
	const headers = sheet[0] ?? [];
	const customerName = indexOf(headers, [
		"ten khach hang",
		"khach hang",
		"ten don vi",
	]);
	const customerCode = indexOf(headers, ["ma khach hang", "ma kh", "ma khach"]);
	const carrier = indexOf(headers, ["nha xe lien ket", "nha xe", "chanh xe"]);
	const address = indexOf(headers, ["dia chi", "dia chi giao hang"]);
	if (customerName < 0)
		throw new Error("Không tìm thấy cột “Tên khách hàng” trong file.");

	const existingByName = new Map(
		existingKeys.items.map((item) => [item.nameKey, item.codeKey]),
	);
	const existingCodes = new Set(
		existingKeys.items.map((item) => item.codeKey).filter(Boolean),
	);
	const fileNames = new Set<string>();
	const fileCodes = new Set<string>();
	let readyCount = 0;
	let updateCount = 0;
	let duplicateCount = 0;
	let skippedCount = 0;
	const rows = sheet.slice(1).map((row, index) => {
		const input = {
			customerName: clean(row[customerName]),
			customerCode: customerCode < 0 ? "" : clean(row[customerCode]),
			carrier: carrier < 0 ? "" : clean(row[carrier]),
			address: address < 0 ? "" : clean(row[address]),
		};
		const rowNumber = index + 2;
		const nameKey = normalizeText(input.customerName);
		const codeKey = input.customerCode.trim().toLocaleUpperCase("vi-VN");
		if (!nameKey) {
			skippedCount += 1;
			return {
				...input,
				rowNumber,
				status: "skipped" as const,
				reason: "Thiếu tên khách hàng",
			};
		}
		if (fileNames.has(nameKey) || (codeKey && fileCodes.has(codeKey))) {
			duplicateCount += 1;
			return {
				...input,
				rowNumber,
				status: "duplicate" as const,
				reason:
					codeKey && fileCodes.has(codeKey)
						? "Mã khách hàng trùng trong file"
						: "Tên khách hàng trùng trong file",
			};
		}
		fileNames.add(nameKey);
		if (codeKey) fileCodes.add(codeKey);

		const existingNameCode = existingByName.get(nameKey);
		if (
			codeKey &&
			existingCodes.has(codeKey) &&
			existingNameCode !== undefined &&
			existingNameCode !== codeKey
		) {
			duplicateCount += 1;
			return {
				...input,
				rowNumber,
				status: "duplicate" as const,
				reason: "Tên và mã đang thuộc hai khách hàng khác nhau",
			};
		}
		if (
			(codeKey && existingCodes.has(codeKey)) ||
			(codeKey && existingNameCode === "")
		) {
			updateCount += 1;
			return {
				...input,
				rowNumber,
				status: "update" as const,
				reason: "Cập nhật khách hàng theo mã, giữ liên kết nhà xe",
			};
		}
		if (existingByName.has(nameKey)) {
			duplicateCount += 1;
			return {
				...input,
				rowNumber,
				status: "duplicate" as const,
				reason: "Tên khách hàng đã tồn tại",
			};
		}
		readyCount += 1;
		return { ...input, rowNumber, status: "ready" as const };
	});
	return {
		totalRows: rows.length,
		readyCount,
		updateCount,
		duplicateCount,
		skippedCount,
		rows,
	};
}
