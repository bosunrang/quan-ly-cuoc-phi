import { FileSpreadsheet } from "lucide-react";
import type { CarrierExcelPreview } from "../../../domain/carriers/carrier.model";
import { formatMoney } from "../../../shared/lib/format";
import { Dialog } from "../../../shared/ui/Dialog";

interface Props {
	fileName: string;
	preview: CarrierExcelPreview;
	onClose: () => void;
	onConfirm: () => Promise<void>;
}

const statusLabel = (value: "ready" | "update" | "skipped") =>
	value === "ready" ? "Thêm mới" : value === "update" ? "Cập nhật" : "Bỏ qua";

export function CarrierExcelImportDialog({
	fileName,
	preview,
	onClose,
	onConfirm,
}: Props) {
	const applicable =
		preview.carrierSummary.ready +
		preview.carrierSummary.update +
		preview.rateSummary.ready +
		preview.rateSummary.update;
	const rows = [
		...preview.rates.map((row) => ({
			...row,
			key: `rate-${row.rowNumber}-${row.carrierName}-${row.customerName}-${row.spec}`,
		})),
		...preview.carriers.map((row) => ({
			...row,
			key: `carrier-${row.rowNumber}-${row.name}`,
		})),
	].slice(0, 100);
	return (
		<Dialog
			title="Kiểm tra bảng cước Excel"
			subtitle={fileName}
			confirmLabel={`Nhập ${applicable} thay đổi`}
			confirmDisabled={applicable === 0}
			onConfirm={onConfirm}
			onClose={onClose}
			className="carrier-excel-dialog"
		>
			<div className="carrier-import-file">
				<FileSpreadsheet size={22} />
				<div>
					<strong>
						Nhà xe: {preview.carriers.length} dòng · Bảng cước:{" "}
						{preview.rates.length} dòng
					</strong>
					<span>
						Dòng trùng sẽ cập nhật mức cước hiện có; dòng lỗi không được nhập.
					</span>
				</div>
			</div>
			<div className="carrier-excel-summary">
				<Summary title="Nhà xe" summary={preview.carrierSummary} />
				<Summary title="Bảng cước" summary={preview.rateSummary} />
			</div>
			<div className="carrier-import-table-wrap">
				<table className="carrier-import-table carrier-excel-table">
					<thead>
						<tr>
							<th>Dòng</th>
							<th>Nhà xe</th>
							<th>Đơn vị</th>
							<th>Quy cách</th>
							<th>Cước VC</th>
							<th>Phí cổng</th>
							<th>Trạng thái</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.key}>
								<td>{row.rowNumber}</td>
								<td>
									<strong>{row.carrierName ?? row.name ?? "—"}</strong>
								</td>
								<td>{row.customerName ?? "—"}</td>
								<td>{row.spec ?? "—"}</td>
								<td>
									{row.transportFee === undefined
										? "—"
										: formatMoney(row.transportFee)}
								</td>
								<td>
									{row.gateFee === undefined ? "—" : formatMoney(row.gateFee)}
								</td>
								<td>
									<span className={`carrier-import-status is-${row.status}`}>
										{row.reason ?? statusLabel(row.status)}
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="carrier-import-limit">Hiển thị 100 dòng đầu trong file.</p>
		</Dialog>
	);
}

function Summary({
	title,
	summary,
}: {
	title: string;
	summary: CarrierExcelPreview["rateSummary"];
}) {
	return (
		<article>
			<strong>{title}</strong>
			<span>{summary.ready} thêm mới</span>
			<span>{summary.update} cập nhật</span>
			<span>{summary.skipped} bỏ qua</span>
		</article>
	);
}
