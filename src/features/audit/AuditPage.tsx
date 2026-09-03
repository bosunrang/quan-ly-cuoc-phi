import {
	ChevronLeft,
	ChevronRight,
	Eye,
	History,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type AuditEntry,
	type AuditFilters,
	actionLabel,
	actionTone,
	entityLabel,
} from "../../domain/audit/audit.model";
import { auditRepository } from "../../domain/audit/audit.repository";
import { formatDateTime } from "../../shared/lib/format";
import { Alert } from "../../shared/ui/Alert";

import { DateInput } from "../../shared/ui/DateInput/DateInput";
import { Dialog } from "../../shared/ui/Dialog";
import { EmptyState, LoadingState, PanelHeader } from "../../shared/ui/Panel";
import { StatusPill } from "../../shared/ui/StatusPill";
import "./audit.css";

const PAGE_SIZE = 50;
const defaultCleanupDate = () => {
	const date = new Date();
	date.setMonth(date.getMonth() - 6);
	return date.toISOString().slice(0, 10);
};
const detailLabels: Record<string, string> = {
	id: "Mã phiếu",
	entryDate: "Ngày gửi",
	customer: "Khách hàng",
	carrier: "Nhà xe",
	recipient: "Người nhận",
	address: "Địa chỉ giao hàng",
	spec: "Quy cách",
	ticketFee: "Phí cước",
	transportFee: "Cước vận chuyển",
	gateFee: "Phí vào cổng",
	note: "Ghi chú",
	misaDocumentDate: "Ngày chứng từ MISA",
	misaDocumentCode: "Mã đơn MISA",
	username: "Tên đăng nhập",
	fullName: "Họ tên",
	pages: "Thẻ được cấp",
	periodFrom: "Từ ngày",
	periodTo: "Đến ngày",
	employeeId: "Nhân viên",
	distanceKm: "Quãng đường",
	totalFee: "Tổng tiền",
	effectiveDate: "Ngày hiệu lực",
	price: "Giá",
	source: "Nguồn giá",
	fileName: "Tên tệp",
	inserted: "Đã thêm",
	duplicates: "Dòng trùng",
	type: "Loại báo cáo",
	sheetCount: "Số sheet",
	from: "Từ ngày",
	to: "Đến ngày",
	extraCosts: "Chi phí thêm",
};

function detailValue(value: unknown): string {
	if (value === null || value === undefined || value === "") return "—";
	if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
	if (typeof value === "object") return "Có dữ liệu chi tiết";
	return String(value);
}

function detailRows(detail: unknown): Array<[string, string]> {
	if (!detail || typeof detail !== "object" || Array.isArray(detail)) return [];
	return Object.entries(detail as Record<string, unknown>)
		.filter(([key]) => key !== "before" && key !== "after" && key !== "legs")
		.slice(0, 8)
		.map(([key, value]) => [detailLabels[key] ?? key, detailValue(value)]);
}

export function AuditPage({ isAdmin }: { isAdmin: boolean }) {
	const [items, setItems] = useState<AuditEntry[] | null>(null);
	const [total, setTotal] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [detail, setDetail] = useState<AuditEntry | null>(null);
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(false);
	const [cleanupOpen, setCleanupOpen] = useState(false);
	const [cleanupBefore, setCleanupBefore] = useState(defaultCleanupDate);

	const load = useCallback(async (filters: AuditFilters, targetPage = 1) => {
		setLoading(true);
		try {
			setError(null);
			const result = await auditRepository.list({
				...filters,
				limit: PAGE_SIZE,
				offset: (targetPage - 1) * PAGE_SIZE,
			});
			setItems(result.items);
			setTotal(result.total);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không tải được nhật ký.",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	const filters = useMemo<AuditFilters>(
		() => ({ q: debouncedQuery }),
		[debouncedQuery],
	);
	useEffect(() => {
		void load(filters, page);
	}, [filters, load, page]);
	useEffect(() => {
		const timer = window.setTimeout(() => {
			setPage(1);
			setDebouncedQuery(query.trim());
		}, 250);
		return () => window.clearTimeout(timer);
	}, [query]);

	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const summary = `${total} bản ghi · Trang ${page}/${pageCount}`;
	const cleanup = async () => {
		await auditRepository.cleanup(cleanupBefore);
		setCleanupOpen(false);
		setPage(1);
		await load(filters, 1);
	};
	if (!items && !error) return <LoadingState />;
	if (!items) return <EmptyState>Không tải được dữ liệu nhật ký.</EmptyState>;

	return (
		<>
			{error && <Alert tone="error">{error}</Alert>}
			<section className="panel audit-intro">
				<PanelHeader
					title="Nhật ký hoạt động"
					description="Theo dõi các thay đổi quan trọng trong hệ thống."
					icon={<History size={19} />}
					actions={
						<div className="audit-intro-actions">
							<button
								type="button"
								className="button secondary"
								disabled={loading}
								onClick={() => void load(filters, page)}
							>
								<RefreshCw size={15} /> Làm mới
							</button>
							{isAdmin && (
								<button
									type="button"
									className="button danger"
									onClick={() => setCleanupOpen(true)}
								>
									<Trash2 size={15} /> Dọn nhật ký
								</button>
							)}
						</div>
					}
				/>
			</section>

			<section className="panel data-panel audit-log-panel">
				<PanelHeader title="Hoạt động gần đây" description={summary} />
				<div className="audit-toolbar">
					<label className="audit-search">
						<Search size={16} />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Tìm người dùng, phiếu, xăng, báo cáo..."
							aria-label="Tìm nhật ký"
						/>
					</label>
				</div>

				{items.length === 0 ? (
					<EmptyState>Không có hoạt động phù hợp với bộ lọc.</EmptyState>
				) : (
					<>
						<div className="table-scroll large-table audit-table">
							<table>
								<thead>
									<tr>
										<th>Thời điểm</th>
										<th>Người thực hiện</th>
										<th>Hoạt động</th>
										<th>Đối tượng</th>
										<th>Chi tiết</th>
									</tr>
								</thead>
								<tbody>
									{items.map((row) => (
										<tr key={row.id}>
											<td className="audit-time">{formatDateTime(row.at)}</td>
											<td>
												<strong>{row.username || "Hệ thống"}</strong>
											</td>
											<td>
												<StatusPill tone={actionTone(row.action)}>
													{actionLabel(row.action)}
												</StatusPill>
											</td>
											<td className="audit-entity">
												{entityLabel(row.entity, row.entityId)}
											</td>
											<td>
												{row.detail ? (
													<button
														type="button"
														className="text-button audit-detail-button"
														onClick={() => setDetail(row)}
													>
														<Eye size={15} /> Xem
													</button>
												) : (
													<span className="cell-meta">—</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{pageCount > 1 && (
							<div className="audit-pagination">
								<button
									type="button"
									className="button secondary"
									title="Trang trước"
									aria-label="Trang trước"
									disabled={loading || page === 1}
									onClick={() => setPage((current) => current - 1)}
								>
									<ChevronLeft size={16} />
								</button>
								<span>
									Trang {page} / {pageCount}
								</span>
								<button
									type="button"
									className="button secondary"
									title="Trang sau"
									aria-label="Trang sau"
									disabled={loading || page === pageCount}
									onClick={() => setPage((current) => current + 1)}
								>
									<ChevronRight size={16} />
								</button>
							</div>
						)}
					</>
				)}
			</section>

			{detail && (
				<Dialog
					title={actionLabel(detail.action)}
					subtitle={`${detail.username || "Hệ thống"} · ${formatDateTime(detail.at)}`}
					confirmLabel="Đóng"
					onConfirm={async () => setDetail(null)}
					onClose={() => setDetail(null)}
					footer={
						<button
							type="button"
							className="button primary"
							onClick={() => setDetail(null)}
						>
							Đóng
						</button>
					}
				>
					<div className="audit-detail-grid">
						<div>
							<span>Đối tượng</span>
							<strong>{entityLabel(detail.entity, detail.entityId)}</strong>
						</div>
						{detailRows(detail.detail).map(([label, value]) => (
							<div key={label}>
								<span>{label}</span>
								<strong>{value}</strong>
							</div>
						))}
					</div>
					{detail.detail !== null && detail.detail !== undefined && (
						<details className="audit-raw-detail">
							<summary>Dữ liệu kỹ thuật</summary>
							<pre className="detail-json">
								{JSON.stringify(detail.detail, null, 2)}
							</pre>
						</details>
					)}
				</Dialog>
			)}

			{cleanupOpen && (
				<Dialog
					title="Dọn nhật ký hoạt động"
					subtitle="Không thể khôi phục các bản ghi đã xóa."
					confirmLabel="Dọn nhật ký"
					className="audit-cleanup-dialog"
					onConfirm={cleanup}
					onClose={() => setCleanupOpen(false)}
				>
					<p className="audit-cleanup-note">
						Chỉ xóa các hoạt động xảy ra trước ngày đã chọn. Thao tác dọn này sẽ
						được ghi lại trong nhật ký.
					</p>
					<div className="audit-cleanup-date">
						<span>Xóa nhật ký trước ngày</span>
						<DateInput
							value={cleanupBefore}
							ariaLabel="Xóa nhật ký trước ngày"
							onChange={setCleanupBefore}
						/>
					</div>
				</Dialog>
			)}
		</>
	);
}
