// Định dạng hiển thị. Không chứa quy tắc nghiệp vụ.

const money = new Intl.NumberFormat("vi-VN");

/** 385000 -> "385.000" */
export const formatMoney = (value: number): string => money.format(value ?? 0);

/** "2026-08-29" -> "29/08/2026" */
export const formatDate = (iso: string): string =>
	iso ? iso.slice(0, 10).split("-").reverse().join("/") : "";

/** ISO timestamp -> "14:53 29/08/2026" */
export function formatDateTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const time = date.toLocaleTimeString("vi-VN", {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	const day = date.toLocaleDateString("vi-VN", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
	return `${time} ${day}`;
}

/** Đổi ngày theo múi giờ của máy sang định dạng input[type=date]. */
export function localIsoDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** Ngày hôm nay theo múi giờ của máy, dùng cho input[type=date]. */
export const todayIso = (): string => localIsoDate(new Date());

/** "Nguyễn Thị Lan" -> "TL" cho ô avatar. */
export function initials(name: string): string {
	return (
		(name ?? "")
			.trim()
			.split(/\s+/)
			.slice(-2)
			.map((part) => part[0] ?? "")
			.join("")
			.toUpperCase() || "?"
	);
}
