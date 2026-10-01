import { CheckCircle2, CircleSlash2, FileSpreadsheet } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type {
	CarrierExcelPreview,
	CarrierExcelPreviewRow,
} from "../../../domain/carriers/carrier.model";
import { formatMoney } from "../../../shared/lib/format";
import { Dialog } from "../../../shared/ui/Dialog";

type ImportKind = "carriers" | "rates";
type Filter = "all" | "actionable" | "ignored";

interface Props {
	fileName: string;
	kind: ImportKind;
	preview: CarrierExcelPreview;
	onClose: () => void;
	onConfirm: () => Promise<void>;
}

export function CarrierExcelImportDialog({
	fileName,
	kind,
	preview,
	onClose,
	onConfirm,
}: Props) {
	const [filter, setFilter] = useState<Filter>("all");
	const title =
		kind === "carriers" ? "Kiểm tra file nhà xe" : "Kiểm tra file bảng cước";
	const rows = kind === "carriers" ? preview.carriers : preview.rates;
	const summary =
		kind === "carriers" ? preview.carrierSummary : preview.rateSummary;
	const actionableCount = summary.ready + summary.update;
	const visibleRows = useMemo(
		() =>
			rows
				.filter((row) => {
					if (filter === "all") return true;
					if (filter === "actionable")
						return row.status === "ready" || row.status === "update";
					return row.status === "duplicate" || row.status === "skipped";
				})
				.slice(0, 100),
		[filter, rows],
	);
	const filterCount = (next: Filter) => {
		if (next === "all") return rows.length;
		if (next === "actionable") return actionableCount;
		return summary.duplicate + summary.skipped;
	};
	const fileLabel = kind === "carriers" ? "Nhà xe" : "Bảng cước";

	return (
		<Dialog
			title={title}
			subtitle={fileName}
			confirmLabel={`Nhập / cập nhật ${actionableCount.toLocaleString("vi-VN")} dòng`}
			confirmDisabled={actionableCount === 0}
			onConfirm={onConfirm}
			onClose={onClose}
			className="carrier-excel-dialog"
		>
			<div className="carrier-import-file">
				<FileSpreadsheet size={22} />
				<div>
					<strong>{fileLabel}</strong>
					<span>
						Toàn bộ {rows.length.toLocaleString("vi-VN")} dòng được rà soát. Nhà
						xe có điểm giao / bến xe mới sẽ được cập nhật; dòng trùng hoặc lỗi
						sẽ không được nhập.
					</span>
				</div>
			</div>
			<div className="carrier-preview-stats">
				<FilterButton
					active={filter === "all"}
					count={filterCount("all")}
					icon={<FileSpreadsheet size={17} />}
					label="Toàn bộ"
					tone="all"
					onClick={() => setFilter("all")}
				/>
				<FilterButton
					active={filter === "actionable"}
					count={filterCount("actionable")}
					icon={<CheckCircle2 size={17} />}
					label="Sẵn sàng xử lý"
					tone="actionable"
					onClick={() => setFilter("actionable")}
				/>
				<FilterButton
					active={filter === "ignored"}
					count={filterCount("ignored")}
					icon={<CircleSlash2 size={17} />}
					label="Không nhập"
					tone="ignored"
					onClick={() => setFilter("ignored")}
				/>
			</div>
			<div className="carrier-import-table-wrap">
				<table
					className={`carrier-import-table carrier-excel-table is-${kind}`}
				>
					<thead>
						<tr>
							<th>Dòng</th>
							<th>Nhà xe</th>
							{kind === "rates" && <th>Mã khách hàng</th>}
							{kind === "rates" && <th>Khách hàng</th>}
							{kind === "rates" && <th>Quy cách</th>}
							{kind === "carriers" && <th>Địa chỉ</th>}
							{kind === "carriers" && <th>Điểm giao / Bến xe</th>}
							{kind === "carriers" && <th>Số điện thoại</th>}
							{kind === "rates" && <th>Cước vận chuyển</th>}
							{kind === "rates" && <th>Phí vào cổng</th>}
							<th>Trạng thái</th>
						</tr>
					</thead>
					<tbody>
						{visibleRows.map((row) => (
							<PreviewRow key={rowKey(row)} kind={kind} row={row} />
						))}
					</tbody>
				</table>
			</div>
			<p className="carrier-import-limit">
				Hiển thị 100 dòng đầu theo bộ lọc. Khi xác nhận, toàn bộ{" "}
				{actionableCount.toLocaleString("vi-VN")} dòng sẽ được nhập hoặc cập
				nhật.
			</p>
		</Dialog>
	);
}

function PreviewRow({
	kind,
	row,
}: {
	kind: ImportKind;
	row: CarrierExcelPreviewRow;
}) {
	return (
		<tr>
			<td>{row.rowNumber}</td>
			<td>
				<strong>{row.carrierName ?? row.name ?? "—"}</strong>
				{row.reason && <small>{row.reason}</small>}
			</td>
			{kind === "rates" && <td>{row.customerCode ?? "—"}</td>}
			{kind === "rates" && <td>{row.customerName ?? "—"}</td>}
			{kind === "rates" && <td>{row.spec ?? "—"}</td>}
			{kind === "carriers" && <td>{row.address ?? "—"}</td>}
			{kind === "carriers" && <td>{row.deliveryPoint ?? "—"}</td>}
			{kind === "carriers" && <td>{row.phone ?? "—"}</td>}
			{kind === "rates" && <td>{formatPreviewMoney(row.transportFee)}</td>}
			{kind === "rates" && <td>{formatPreviewMoney(row.gateFee)}</td>}
			<td>
				<span className={`carrier-import-status is-${row.status}`}>
					{statusLabel(row.status)}
				</span>
			</td>
		</tr>
	);
}

function FilterButton({
	active,
	count,
	icon,
	label,
	tone,
	onClick,
}: {
	active: boolean;
	count: number;
	icon: ReactNode;
	label: string;
	tone: Filter;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={`is-${tone}${active ? " is-active" : ""}`}
			aria-pressed={active}
			onClick={onClick}
		>
			<span className="carrier-preview-stat-icon">{icon}</span>
			<span>{label}</span>
			<strong>{count.toLocaleString("vi-VN")}</strong>
		</button>
	);
}

function rowKey(row: CarrierExcelPreviewRow): string {
	return [
		row.rowNumber,
		row.carrierName ?? row.name,
		row.customerCode,
		row.customerName,
		row.spec,
	].join("-");
}

function statusLabel(status: CarrierExcelPreviewRow["status"]): string {
	if (status === "ready") return "Sẵn sàng";
	if (status === "update") return "Cập nhật";
	if (status === "duplicate") return "Trùng";
	return "Bỏ qua";
}

function formatPreviewMoney(value: number | undefined): string {
	return value === undefined ? "—" : formatMoney(value);
}
