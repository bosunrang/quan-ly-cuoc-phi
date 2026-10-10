// Đọc số tiền người dùng dán vào ô nhập. Không chứa quy tắc nghiệp vụ.

const CURRENCY = /\s|vnđ|vnd|đ|₫/gi;
const DECIMAL_TAIL = /[.,](\d{1,2})$/;
// Dưới Number.MAX_SAFE_INTEGER; máy chủ còn giới hạn chặt hơn.
const MAX_DIGITS = 15;

/**
 * Số tiền dán từ Excel hoặc hóa đơn có phần thập phân: "1,234.00",
 * "1.234,50 đ", "385.000,00". Dấu chấm/phẩy theo sau bởi 1–2 chữ số ở cuối là
 * phần thập phân (nhóm hàng nghìn luôn đủ 3 chữ số) và được làm tròn tới đồng.
 *
 * Trả về null khi không có phần thập phân: khi đó ô nhập cứ bỏ ký tự không phải
 * số như khi gõ tay. Chỉ dùng cho nội dung dán vào, vì khi gõ tay xóa lùi
 * "1.234" thành "1.23" vẫn phải hiểu là 123.
 */
export function parsePastedMoney(text: string): number | null {
	const cleaned = text.replace(CURRENCY, "");
	if (!/^\d[\d.,]*$/.test(cleaned)) return null;
	const decimal = DECIMAL_TAIL.exec(cleaned);
	if (!decimal) return null;
	const digits = cleaned.slice(0, decimal.index).replace(/[.,]/g, "");
	if (digits.length > MAX_DIGITS) return null;
	return Math.round(Number(`${digits || "0"}.${decimal[1]}`));
}
