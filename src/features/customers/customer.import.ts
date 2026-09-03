import { type Row, readSheet } from "read-excel-file/browser";
import type { CustomerInput } from "../../domain/customers/customer.model";
import { normalizeText } from "../../shared/lib/text";

export type CustomerImportStatus = "ready" | "duplicate" | "skipped";

export interface CustomerImportRow extends CustomerInput {
	rowNumber: number;
	status: CustomerImportStatus;
	reason?: string;
}

export interface CustomerImportPreview {
	totalRows: number;
	readyCount: number;
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
	existingCustomerNames: string[],
): Promise<CustomerImportPreview> {
	const sheet = await readSheet(file);
	const headers = sheet[0] ?? [];
	const customerName = indexOf(headers, [
		"ten khach hang",
		"khach hang",
		"ten don vi",
	]);
	const carrier = indexOf(headers, ["nha xe lien ket", "nha xe", "chanh xe"]);
	const recipient = indexOf(headers, ["nguoi nhan", "ten nguoi nhan"]);
	const address = indexOf(headers, ["dia chi", "dia chi giao hang"]);
	if (customerName < 0)
		throw new Error("Không tìm thấy cột “Tên khách hàng” trong file.");

	const seen = new Set(existingCustomerNames.map(normalizeText));
	let readyCount = 0;
	let duplicateCount = 0;
	let skippedCount = 0;
	const rows = sheet.slice(1).map((row, index) => {
		const input = {
			customerName: clean(row[customerName]),
			carrier: carrier < 0 ? "" : clean(row[carrier]),
			recipient: recipient < 0 ? "" : clean(row[recipient]),
			address: address < 0 ? "" : clean(row[address]),
		};
		const rowNumber = index + 2;
		const key = normalizeText(input.customerName);
		if (!key) {
			skippedCount += 1;
			return {
				...input,
				rowNumber,
				status: "skipped" as const,
				reason: "Thiếu tên khách hàng",
			};
		}
		if (seen.has(key)) {
			duplicateCount += 1;
			return {
				...input,
				rowNumber,
				status: "duplicate" as const,
				reason: "Tên khách hàng đã tồn tại",
			};
		}
		seen.add(key);
		readyCount += 1;
		return { ...input, rowNumber, status: "ready" as const };
	});
	return {
		totalRows: rows.length,
		readyCount,
		duplicateCount,
		skippedCount,
		rows,
	};
}
