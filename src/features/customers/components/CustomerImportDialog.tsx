import {
	CheckCircle2,
	CircleSlash2,
	CopyCheck,
	FileSpreadsheet,
	RefreshCw,
} from "lucide-react";
import { Dialog } from "../../../shared/ui/Dialog";
import type {
	CustomerImportPreview,
	CustomerImportStatus,
} from "../customer.import";

interface Props {
	fileName: string;
	preview: CustomerImportPreview;
	onClose: () => void;
	onConfirm: () => Promise<void>;
}

export function CustomerImportDialog({
	fileName,
	preview,
	onClose,
	onConfirm,
}: Props) {
	return (
		<Dialog
			title="Kiểm tra dữ liệu trước khi nhập"
			subtitle={fileName}
			confirmLabel={`Xử lý ${preview.readyCount + preview.updateCount} khách hàng`}
			confirmDisabled={preview.readyCount + preview.updateCount === 0}
			onConfirm={onConfirm}
			onClose={onClose}
			className="customer-import-dialog"
		>
			<div className="customer-import-file">
				<FileSpreadsheet size={22} />
				<div>
					<strong>{fileName}</strong>
					<span>
						Toàn bộ {preview.totalRows.toLocaleString("vi-VN")} dòng được rà
						soát; chỉ các dòng sẵn sàng mới được ghi vào dữ liệu.
					</span>
				</div>
			</div>
			<div className="customer-import-stats">
				<ImportStat label="Tổng dòng" count={preview.totalRows} tone="all" />
				<ImportStat
					label="Sẵn sàng nhập"
					count={preview.readyCount}
					tone="ready"
				/>
				<ImportStat
					label="Cập nhật theo mã"
					count={preview.updateCount}
					tone="update"
				/>
				<ImportStat
					label="Dòng trùng"
					count={preview.duplicateCount}
					tone="duplicate"
				/>
				<ImportStat
					label="Bỏ qua"
					count={preview.skippedCount}
					tone="skipped"
				/>
			</div>
			<div className="customer-import-table-wrap">
				<table className="customer-import-table">
					<thead>
						<tr>
							<th>Dòng</th>
							<th>Mã khách hàng</th>
							<th>Tên khách hàng</th>
							<th>Nhà xe liên kết</th>
							<th>Địa chỉ</th>
							<th>Trạng thái</th>
						</tr>
					</thead>
					<tbody>
						{preview.rows.slice(0, 100).map((row) => (
							<tr key={`${row.rowNumber}-${row.customerName}`}>
								<td>{row.rowNumber}</td>
								<td>{row.customerCode || "—"}</td>
								<td>
									<strong>{row.customerName || "—"}</strong>
									{row.reason && <small>{row.reason}</small>}
								</td>
								<td>{row.carrier || "—"}</td>
								<td>{row.address || "—"}</td>
								<td>
									<span className={`customer-import-status is-${row.status}`}>
										{statusLabel(row.status)}
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="customer-import-limit">
				Hiển thị 100 dòng đầu để xem nhanh. Khi xác nhận, toàn bộ{" "}
				{(preview.readyCount + preview.updateCount).toLocaleString("vi-VN")}{" "}
				dòng sẽ được xử lý; dòng trùng hoặc thiếu tên sẽ bỏ qua.
			</p>
		</Dialog>
	);
}

function statusLabel(status: CustomerImportStatus): string {
	if (status === "ready") return "Sẵn sàng";
	if (status === "update") return "Cập nhật";
	if (status === "duplicate") return "Trùng";
	return "Bỏ qua";
}

function ImportStat({
	label,
	count,
	tone,
}: {
	label: string;
	count: number;
	tone: "all" | CustomerImportStatus;
}) {
	const icon =
		tone === "ready" ? (
			<CheckCircle2 size={17} />
		) : tone === "update" ? (
			<RefreshCw size={17} />
		) : tone === "duplicate" ? (
			<CopyCheck size={17} />
		) : tone === "skipped" ? (
			<CircleSlash2 size={17} />
		) : (
			<FileSpreadsheet size={17} />
		);
	return (
		<article className={`is-${tone}`}>
			<span className="customer-import-stat-icon">{icon}</span>
			<span>{label}</span>
			<strong>{count.toLocaleString("vi-VN")}</strong>
		</article>
	);
}
