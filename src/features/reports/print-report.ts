import type { PrintableReport } from "../../domain/reports/report.model";

function escapeHtml(value: string | number): string {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function printableReportHtml(report: PrintableReport): string {
	const title =
		report.type === "daily"
			? "Bảng kê cước gửi hàng"
			: "Báo cáo cước gửi hàng theo năm";
	const sheets = report.sheets
		.map((sheet) => {
			// Chỉ nới trên bản in: giữ nguyên độ rộng cột của workbook Excel.
			const printWidths = sheet.columnWidths.map((width, index) =>
				report.type === "daily" && sheet.columnWidths.length >= 18
					? index === 0
						? Math.max(width, 9)
						: index === 12
							? Math.max(width, 8.5)
							: width
					: width,
			);
			const totalWidth = printWidths.reduce((sum, width) => sum + width, 0);
			const columns = printWidths
				.map(
					(width) =>
						`<col width="${((width / totalWidth) * 100).toFixed(4)}%">`,
				)
				.join("");
			const rows = sheet.rows
				.map((row) => {
					const cells = row.cells
						.map((cell) => {
							const classes = [
								cell.border ? "bordered" : "",
								cell.bold ? "bold" : "",
								cell.italic ? "italic" : "",
								["left", "center", "right"].includes(cell.align)
									? `align-${cell.align}`
									: "align-left",
								cell.color.toUpperCase() === "FF0000"
									? "color-red"
									: cell.color.toUpperCase() === "00682F"
										? "color-green"
										: "",
								cell.address.startsWith("M") && cell.value.includes("☑")
									? "bill"
									: "",
							]
								.filter(Boolean)
								.join(" ");
							return `<td data-cell="${escapeHtml(cell.address)}" rowspan="${cell.rowSpan}" colspan="${cell.colSpan}" class="${classes}">${escapeHtml(cell.value)}</td>`;
						})
						.join("");
					return `<tr data-row="${row.number}">${cells}</tr>`;
				})
				.join("");
			const density = sheet.columnWidths.length >= 18 ? "daily" : "compact";
			return `<section class="sheet ${density}"><table><colgroup>${columns}</colgroup><tbody>${rows}</tbody></table></section>`;
		})
		.join("");
	return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/report-print.css?v=2"></head><body>${sheets}</body></html>`;
}
