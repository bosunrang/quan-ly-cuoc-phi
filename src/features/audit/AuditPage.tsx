import {
	ChevronLeft,
	ChevronRight,
	History,
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
import {
	formatDate,
	formatDateTime,
	localIsoDate,
} from "../../shared/lib/format";
import { Alert } from "../../shared/ui/Alert";

import { DateInput } from "../../shared/ui/DateInput/DateInput";
import { Dialog } from "../../shared/ui/Dialog";
import { EmptyState, LoadingState, PanelHeader } from "../../shared/ui/Panel";
import { StatusPill } from "../../shared/ui/StatusPill";
import "./audit.css";

const PAGE_SIZE = 50;
const CLIENT_SEARCH_LIMIT = 500;
const defaultCleanupDate = () => {
	const date = new Date();
	date.setMonth(date.getMonth() - 6);
	return localIsoDate(date);
};
const detailLabels: Record<string, string> = {
	id: "Mã phiếu",
	entryId: "Mã phiếu",
	carrierId: "Mã nhà xe",
	customerId: "Mã khách hàng",
	userId: "Mã người dùng",
	entryDate: "Ngày gửi",
	customer: "Khách hàng",
	carrier: "Nhà xe",
	customerName: "Khách hàng",
	name: "Tên",
	contact: "Người liên hệ",
	phone: "Số điện thoại",
	schedule: "Lịch xe",
	recipient: "Người nhận",
	address: "Địa chỉ giao hàng",
	spec: "Quy cách",
	ticketFee: "Phí cước",
	transportFee: "Cước vận chuyển",
	gateFee: "Phí vào cổng",
	standardTransportFee: "Cước thiết lập",
	rateVarianceNote: "Ghi chú chênh lệch cước",
	duplicateReason: "Lý do nhập trùng",
	note: "Ghi chú",
	misaDocumentDate: "Ngày chứng từ MISA",
	misaDocumentCode: "Mã đơn MISA",
	username: "Tên đăng nhập",
	fullName: "Họ tên",
	isAdmin: "Quản trị viên",
	pages: "Thẻ được cấp",
	periodFrom: "Từ ngày",
	periodTo: "Đến ngày",
	employeeId: "Nhân viên",
	employeeName: "Nhân viên",
	linkedUsername: "Tài khoản liên kết",
	createdBy: "Người tạo",
	createdByName: "Người tạo",
	distanceKm: "Quãng đường",
	consumptionLiters: "Mức tiêu hao",
	consumptionBaseKm: "Định mức quãng đường",
	fuelType: "Loại xăng",
	region: "Khu vực",
	fuelPrice: "Giá xăng",
	totalFee: "Tổng tiền",
	effectiveDate: "Ngày hiệu lực",
	price: "Giá",
	rate: "Mức cước",
	isDefault: "Mức cước mặc định",
	source: "Nguồn giá",
	fileName: "Tên tệp",
	requested: "Dòng yêu cầu",
	inserted: "Đã thêm",
	duplicates: "Dòng trùng",
	skipped: "Dòng bỏ qua",
	carriersCreated: "Nhà xe đã thêm",
	carriersUpdated: "Nhà xe đã cập nhật",
	ratesCreated: "Mức cước đã thêm",
	ratesUpdated: "Mức cước đã cập nhật",
	type: "Loại báo cáo",
	sheetCount: "Số sheet",
	from: "Từ ngày",
	to: "Đến ngày",
	beforeDate: "Trước ngày",
	extraCosts: "Chi phí thêm",
	isActive: "Trạng thái hoạt động",
	groups: "Nhóm dữ liệu",
	deleted: "Đã xóa",
	detachedEmployeeLinks: "Liên kết nhân viên đã gỡ",
	rows: "Số dòng",
	reason: "Lý do",
	customerIds: "Khách hàng được gán",
	status: "Trạng thái",
	voidReason: "Lý do hủy",
	createdAt: "Thời điểm tạo",
	updatedAt: "Thời điểm cập nhật",
	carrierKey: "Mã nhà xe",
	assignedCustomerIds: "Khách hàng được gán",
	companyName: "Tên đơn vị",
	companyAddress: "Địa chỉ đơn vị",
	displayName: "Tên hiển thị",
	tagline: "Khẩu hiệu",
	logoDataUrl: "Logo đơn vị",
	all: "Toàn bộ thời gian",
};

const dataGroupLabels: Record<string, string> = {
	entries: "Phiếu cước",
	misa: "Dữ liệu MISA",
	customers: "Khách hàng",
	carriers: "Nhà xe",
	employees: "Nhân viên",
	fuel: "Dữ liệu xăng",
	users: "Tài khoản",
};
const pageLabels: Record<string, string> = {
	dashboard: "Tổng quan",
	entries: "Phiếu cước",
	customers: "Khách hàng",
	carriers: "Nhà xe",
	employees: "Nhân viên",
	fuel: "Tính xăng",
	misa: "Dữ liệu MISA",
	reports: "Báo cáo",
	settings: "Cài đặt",
	users: "Tài khoản",
	audit: "Nhật ký hoạt động",
};

function detailValue(value: unknown, key = ""): string {
	if (value === null || value === undefined || value === "") return "—";
	if (typeof value === "boolean") return value ? "Có" : "Không";
	if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return formatDate(value);
	}
	if (
		typeof value === "string" &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
	) {
		return formatDateTime(value);
	}
	if (Array.isArray(value)) {
		if (!value.length) return "—";
		if (key === "groups")
			return value
				.map((item) => dataGroupLabels[String(item)] ?? item)
				.join(", ");
		if (key === "pages")
			return value.map((item) => pageLabels[String(item)] ?? item).join(", ");
		return value.join(", ");
	}
	if (key === "type") {
		return value === "annual"
			? "Báo cáo năm"
			: value === "daily"
				? "Báo cáo ngày"
				: String(value);
	}
	if (key === "region") {
		return value === "region1"
			? "Vùng 1"
			: value === "region2"
				? "Vùng 2"
				: String(value);
	}
	if (key === "source") {
		return value === "manual" ? "Nhập tay" : String(value);
	}
	if (key === "status") {
		return value === "active"
			? "Đang hoạt động"
			: value === "voided"
				? "Đã hủy"
				: String(value);
	}
	if (typeof value === "object") return "Có dữ liệu chi tiết";
	return String(value);
}

function detailLabel(key: string): string {
	// Không hiển thị tên trường kỹ thuật ra giao diện khi máy chủ bổ sung dữ liệu mới.
	return detailLabels[key] ?? "Thông tin bổ sung";
}

export function auditDetailRows(detail: unknown): Array<[string, string]> {
	if (!detail || typeof detail !== "object" || Array.isArray(detail)) return [];
	const values = detail as Record<string, unknown>;
	const before = values.before;
	const after = values.after;
	if (
		before &&
		after &&
		typeof before === "object" &&
		typeof after === "object" &&
		!Array.isArray(before) &&
		!Array.isArray(after)
	) {
		const beforeValues = before as Record<string, unknown>;
		return Object.entries(after as Record<string, unknown>)
			.filter(
				([key, value]) =>
					key !== "id" &&
					key !== "updatedAt" &&
					detailValue(beforeValues[key], key) !== detailValue(value, key),
			)
			.slice(0, 3)
			.map(([key, value]) => [
				detailLabel(key),
				`${detailValue(beforeValues[key], key)} → ${detailValue(value, key)}`,
			]);
	}
	return Object.entries(values)
		.filter(([key]) => key !== "before" && key !== "after" && key !== "legs")
		.slice(0, 3)
		.map(([key, value]) => [detailLabel(key), detailValue(value, key)]);
}

function normalizeSearch(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[đĐ]/g, "d")
		.toLocaleLowerCase("vi-VN");
}

export function matchesAuditSearch(row: AuditEntry, query: string): boolean {
	const needle = normalizeSearch(query.trim());
	if (!needle) return true;
	const detail = auditDetailRows(row.detail).flat().join(" ");
	const searchable = [
		row.username,
		actionLabel(row.action),
		entityLabel(row.entity, row.entityId),
		row.action,
		row.entity,
		row.entityId ?? "",
		detail,
	].join(" ");
	return normalizeSearch(searchable).includes(needle);
}

function matchesAuditPeriod(
	row: AuditEntry,
	from: string,
	to: string,
): boolean {
	const date = localIsoDate(new Date(row.at));
	return (!from || date >= from) && (!to || date <= to);
}

function auditTimeParts(value: string): { time: string; date: string } {
	const formatted = formatDateTime(value);
	const [time = "", date = ""] = formatted.split(" ");
	return { time, date };
}

function AuditTime({ value }: { value: string }) {
	const { time, date } = auditTimeParts(value);
	return (
		<time dateTime={value}>
			<strong>{time}</strong>
			<span>{date}</span>
		</time>
	);
}

function AuditDetails({ detail }: { detail: AuditEntry["detail"] }) {
	const rows = auditDetailRows(detail);
	if (!rows.length) return <span className="cell-meta">—</span>;
	return (
		<div className="audit-detail-content">
			{rows.map(([label, value]) => (
				<span key={`${label}-${value}`} title={`${label}: ${value}`}>
					<strong>{label}:</strong> {value}
				</span>
			))}
		</div>
	);
}

export function AuditPage({ isAdmin }: { isAdmin: boolean }) {
	const [items, setItems] = useState<AuditEntry[] | null>(null);
	const [total, setTotal] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(false);
	const [cleanupOpen, setCleanupOpen] = useState(false);
	const [cleanupBefore, setCleanupBefore] = useState(defaultCleanupDate);

	const load = useCallback(async (filters: AuditFilters, targetPage = 1) => {
		setLoading(true);
		try {
			setError(null);
			const query = filters.q?.trim() ?? "";
			const hasFilters = Boolean(query || filters.from || filters.to);
			const request = {
				from: filters.from,
				to: filters.to,
				// Lấy và lọc cục bộ khi có từ khóa: ứng dụng vẫn hiểu nhãn tiếng
				// Việt và khoảng ngày dù đang kết nối với máy chủ phiên bản cũ.
				limit: hasFilters ? CLIENT_SEARCH_LIMIT : PAGE_SIZE,
				offset: hasFilters ? 0 : (targetPage - 1) * PAGE_SIZE,
			};
			const result = await auditRepository.list(request);
			if (hasFilters) {
				const matched = result.items.filter(
					(row) =>
						matchesAuditSearch(row, query) &&
						matchesAuditPeriod(row, filters.from ?? "", filters.to ?? ""),
				);
				setItems(
					matched.slice((targetPage - 1) * PAGE_SIZE, targetPage * PAGE_SIZE),
				);
				setTotal(matched.length);
			} else {
				setItems(result.items);
				setTotal(result.total);
			}
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không tải được nhật ký.",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	const filters = useMemo<AuditFilters>(
		() => ({ q: debouncedQuery, from, to }),
		[debouncedQuery, from, to],
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
	const updateDateFilter = (field: "from" | "to", value: string) => {
		setPage(1);
		if (field === "from") setFrom(value);
		else setTo(value);
	};
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
					description="Theo dõi ai đã làm gì, vào thời điểm nào và xem lại chi tiết khi cần."
					icon={<History size={19} />}
					actions={
						<div className="audit-intro-actions">
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
				<PanelHeader title="Dòng thời gian hoạt động" description={summary} />
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
					<div className="audit-date-filters">
						<label htmlFor="audit-from-date">
							<span>Từ ngày</span>
							<DateInput
								id="audit-from-date"
								value={from}
								ariaLabel="Từ ngày"
								onChange={(value) => updateDateFilter("from", value)}
							/>
						</label>
						<label htmlFor="audit-to-date">
							<span>Đến ngày</span>
							<DateInput
								id="audit-to-date"
								value={to}
								ariaLabel="Đến ngày"
								onChange={(value) => updateDateFilter("to", value)}
							/>
						</label>
					</div>
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
											<td className="audit-time">
												<AuditTime value={row.at} />
											</td>
											<td className="audit-user">
												<strong>{row.username || "Hệ thống"}</strong>
											</td>
											<td>
												<StatusPill tone={actionTone(row.action)}>
													{actionLabel(row.action)}
												</StatusPill>
											</td>
											<td className="audit-entity">
												<span>{entityLabel(row.entity, row.entityId)}</span>
											</td>
											<td className="audit-detail">
												<AuditDetails detail={row.detail} />
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
