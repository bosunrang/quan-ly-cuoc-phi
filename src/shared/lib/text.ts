/** Chuẩn hoá chuỗi tiếng Việt để so sánh tên/cột không phân biệt dấu, hoa thường. */
export function normalizeText(value: unknown): string {
	return String(value ?? "")
		.trim()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[đĐ]/g, "d")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}
