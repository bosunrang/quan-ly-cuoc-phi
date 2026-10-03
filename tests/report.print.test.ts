import { describe, expect, it } from "vitest";
import type { PrintableReport } from "../src/domain/reports/report.model";
import { printableReportHtml } from "../src/features/reports/print-report";

describe("bản in bảng kê cước", () => {
	it("giữ cột và vùng gộp từ worksheet Excel", () => {
		const cell = (address: string, value: string, rowSpan = 1) => ({
			address,
			value,
			rowSpan,
			colSpan: 1,
			align: "center",
			bold: false,
			italic: false,
			color: "",
			border: true,
		});
		const columns = "ABCDEFGHIJKLMNOPQR".split("");
		const excelWidths = columns.map((_, index) =>
			index === 0 ? 5.42578125 : index === 12 ? 4.42578125 : 10,
		);
		const report: PrintableReport = {
			type: "daily",
			sheets: [
				{
					name: "Bảng kê cước",
					columnWidths: excelWidths,
					rows: [
						{
							number: 11,
							cells: columns.map((column) =>
								cell(
									`${column}11`,
									column === "A" ? "STT" : column === "M" ? "Bill" : column,
								),
							),
						},
						{
							number: 12,
							cells: columns.map((column) =>
								cell(
									`${column}12`,
									column === "E"
										? "Nhà xe A"
										: column === "M"
											? "☑"
											: column === "N"
												? "6,8"
												: "",
									["E", "M"].includes(column) ? 2 : 1,
								),
							),
						},
						{
							number: 13,
							cells: columns
								.filter((column) => !["E", "M"].includes(column))
								.map((column) =>
									cell(`${column}13`, column === "N" ? "3,0" : ""),
								),
						},
					],
				},
			],
		};
		const page = new DOMParser().parseFromString(
			printableReportHtml(report),
			"text/html",
		);
		const table = page.querySelector("table");
		expect(table?.querySelectorAll("col")).toHaveLength(18);
		expect(
			page.querySelector('link[href="/report-print.css?v=2"]'),
		).not.toBeNull();
		expect(page.querySelectorAll("style, [style]")).toHaveLength(0);
		const printWidths = Array.from(table?.querySelectorAll("col") ?? []).map(
			(column) => Number.parseFloat(column.getAttribute("width") ?? "0"),
		);
		const excelTotalWidth = excelWidths.reduce((sum, width) => sum + width, 0);
		expect(printWidths[0]).toBeGreaterThan(
			(excelWidths[0] / excelTotalWidth) * 100,
		);
		expect(printWidths[12]).toBeGreaterThan(
			(excelWidths[12] / excelTotalWidth) * 100,
		);
		expect(table?.querySelector('[data-cell="A11"]')?.className).toContain(
			"align-center",
		);
		expect(
			table?.querySelector('[data-cell="E12"]')?.getAttribute("rowspan"),
		).toBe("2");
		expect(
			table?.querySelector('[data-cell="M12"]')?.getAttribute("rowspan"),
		).toBe("2");
		expect(table?.querySelector('[data-cell="N12"]')?.textContent).toBe("6,8");
		expect(table?.querySelector('[data-cell="N13"]')?.textContent).toBe("3,0");
		expect(table?.querySelectorAll('tr[data-row="13"] td')).toHaveLength(16);
	});
});
