import {
	CheckCircle2,
	CircleSlash2,
	CopyCheck,
	FileSpreadsheet,
	type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
	MisaImportPreview,
	MisaImportStatus,
} from "../../domain/misa/misa.model";
import { formatDate, formatMoney } from "../../shared/lib/format";
import { Dialog } from "../../shared/ui/Dialog";
import { StatusPill } from "../../shared/ui/StatusPill";

type PreviewFilter = "all" | MisaImportStatus;
const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

interface Props {
	preview: MisaImportPreview;
	onClose: () => void;
	onConfirm: () => Promise<void>;
}

const statusMeta: Record<
	MisaImportStatus,
	{
		label: string;
		tone: "success" | "warning" | "neutral";
		icon: LucideIcon;
	}
> = {
	ready: { label: "Sẵn sàng", tone: "success", icon: CheckCircle2 },
	duplicate: { label: "Dòng trùng", tone: "warning", icon: CopyCheck },
	skipped: { label: "Bỏ qua", tone: "neutral", icon: CircleSlash2 },
};

export function MisaImportPreviewDialog({
	preview,
	onClose,
	onConfirm,
}: Props) {
	const [filter, setFilter] = useState<PreviewFilter>("all");
	const visibleRows = useMemo(
		() =>
			preview.rows
				.filter((row) => filter === "all" || row.status === filter)
				.slice(0, 250),
		[filter, preview.rows],
	);
	const filteredCount = preview.rows.filter(
		(row) => filter === "all" || row.status === filter,
	).length;
	const filters: Array<{ value: PreviewFilter; label: string; count: number }> =
		[
			{ value: "all", label: "Tổng dòng", count: preview.totalRows },
			{ value: "ready", label: "Sẵn sàng nhập", count: preview.readyCount },
			{
				value: "duplicate",
				label: "Dòng trùng",
				count: preview.duplicateCount,
			},
			{ value: "skipped", label: "Bỏ qua", count: preview.skippedCount },
		];

	return (
		<Dialog
			title="Kiểm tra dữ liệu trước khi nhập"
			subtitle={preview.fileName}
			confirmLabel={`Xác nhận nhập ${formatMoney(preview.readyCount)} dòng`}
			confirmDisabled={preview.readyCount === 0}
			className="misa-import-preview-dialog"
			onClose={onClose}
			onConfirm={onConfirm}
		>
			<div className="misa-preview-file">
				<span className="misa-preview-file-icon">
					<FileSpreadsheet size={20} />
				</span>
				<div>
					<strong>{preview.fileName}</strong>
					<span>Chỉ các dòng sẵn sàng mới được ghi vào dữ liệu.</span>
				</div>
			</div>

			<div className="misa-preview-stats">
				{filters.map((item) => {
					const className =
						item.value === "ready"
							? "is-ready"
							: item.value === "duplicate"
								? "is-duplicate"
								: item.value === "skipped"
									? "is-skipped"
									: "is-all";
					const icon =
						item.value === "ready" ? (
							<CheckCircle2 size={17} />
						) : item.value === "duplicate" ? (
							<CopyCheck size={17} />
						) : item.value === "skipped" ? (
							<CircleSlash2 size={17} />
						) : (
							<FileSpreadsheet size={17} />
						);

					return (
						<button
							type="button"
							key={item.value}
							className={`${className}${filter === item.value ? " is-active" : ""}`}
							aria-pressed={filter === item.value}
							onClick={() => setFilter(item.value)}
						>
							<span className="misa-preview-stat-icon">{icon}</span>
							<span>{item.label}</span>
							<strong>{formatMoney(item.count)}</strong>
						</button>
					);
				})}
			</div>
			<div className="misa-preview-table-wrap">
				<table className="misa-preview-table">
					<thead>
						<tr>
							<th>Dòng</th>
							<th>Ngày chứng từ</th>
							<th>Số chứng từ</th>
							<th>Mã khách hàng</th>
							<th>Tên khách hàng</th>
							<th>Địa chỉ</th>
							<th>Tên mặt hàng</th>
							<th className="numeric">Số lượng bán</th>
							<th>Tỉnh/Thành</th>
							<th>Trạng thái</th>
						</tr>
					</thead>
					<tbody>
						{visibleRows.map((row) => {
							const meta = statusMeta[row.status];
							const StatusIcon = meta.icon;
							return (
								<tr key={`${row.rowNumber}:${row.sourceKey}`}>
									<td>{row.rowNumber}</td>
									<td>
										{row.documentDate ? formatDate(row.documentDate) : "—"}
									</td>
									<td>{row.documentCode || "—"}</td>
									<td>{row.customerCode || "—"}</td>
									<td className="misa-preview-customer">
										<strong>{row.customerName || "—"}</strong>
										{row.reason && <span>{row.reason}</span>}
									</td>
									<td>{row.address || "—"}</td>
									<td>{row.productName || "—"}</td>
									<td className="numeric">
										{row.quantitySold === null
											? "—"
											: number.format(row.quantitySold)}
									</td>
									<td>{row.provinceCity || "—"}</td>
									<td>
										<StatusPill
											tone={meta.tone}
											icon={<StatusIcon size={13} />}
										>
											{meta.label}
										</StatusPill>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			{filteredCount > visibleRows.length && (
				<p className="misa-preview-limit">
					Đang hiển thị 250/{formatMoney(filteredCount)} dòng trong nhóm này.
				</p>
			)}
		</Dialog>
	);
}
