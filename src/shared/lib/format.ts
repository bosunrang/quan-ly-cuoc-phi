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

/** Ngày hôm nay theo định dạng của input[type=date]. */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

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
