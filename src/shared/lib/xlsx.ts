import { strToU8, zipSync } from "fflate";

type Cell = string | number | boolean | null | undefined;

interface Sheet {
	name: string;
	headers: string[];
	rows: Cell[][];
	widths?: number[];
	moneyColumns?: number[];
	yellowHeader?: boolean;
}

const xmlEscape = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

const column = (index: number) => {
	let value = index + 1;
	let result = "";
	while (value) {
		const remainder = (value - 1) % 26;
		result = String.fromCharCode(65 + remainder) + result;
		value = Math.floor((value - 1) / 26);
	}
	return result;
};

function cell(value: Cell, ref: string, style = 0): string {
	if (value === null || value === undefined || value === "") return "";
	if (typeof value === "number")
		return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
	if (typeof value === "boolean")
		return `<c r="${ref}" t="b"><v>${Number(value)}</v></c>`;
	return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
	const values = [sheet.headers, ...sheet.rows];
	const rows = values
		.map((row, rowIndex) => {
			const cells = row
				.map((value, columnIndex) => {
					const style =
						rowIndex === 0
							? sheet.yellowHeader
								? 3
								: 1
							: sheet.moneyColumns?.includes(columnIndex)
								? 2
								: 0;
					return cell(value, `${column(columnIndex)}${rowIndex + 1}`, style);
				})
				.join("");
			return `<row r="${rowIndex + 1}">${cells}</row>`;
		})
		.join("");
	const widths = (sheet.widths ?? sheet.headers.map(() => 20))
		.map(
			(width, index) =>
				`<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
		)
		.join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths}</cols><sheetData>${rows}</sheetData>
<autoFilter ref="A1:${column(sheet.headers.length - 1)}${values.length}"/>
</worksheet>`;
}

export function downloadXlsx(fileName: string, sheets: Sheet[]): void {
	const workbookSheets = sheets
		.map(
			(sheet, index) =>
				`<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
		)
		.join("");
	const rels = sheets
		.map(
			(_, index) =>
				`<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
		)
		.join("");
	const files: Record<string, Uint8Array> = {
		"[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`),
		"_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
		"xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`),
		"xl/_rels/workbook.xml.rels":
			strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
		"xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B747D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFD966"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`),
	};
	for (const [index, sheet] of sheets.entries()) {
		files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet));
	}
	const blob = new Blob([zipSync(files, { level: 6 })], {
		type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	// Thu hồi ngay có thể hủy lượt tải trước khi trình duyệt đọc xong blob.
	window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
