import {
	Building2,
	Database,
	FileSpreadsheet,
	MapPinned,
	PackageCheck,
	Search,
	Upload,
} from "lucide-react";
import {
	type ChangeEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	MisaImportPreview,
	MisaListFilters,
	MisaListResult,
} from "../../domain/misa/misa.model";
import { misaRepository } from "../../domain/misa/misa.repository";
import {
	formatDate,
	formatDateTime,
	formatMoney,
} from "../../shared/lib/format";
import { Alert } from "../../shared/ui/Alert";
import { EmptyState, LoadingState } from "../../shared/ui/Panel";
import { MisaImportPreviewDialog } from "./MisaImportPreviewDialog";
import { parseMisaWorkbook } from "./misa.import";

const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

export function MisaPage() {
	const inputRef = useRef<HTMLInputElement>(null);
	const requestIdRef = useRef(0);
	const [data, setData] = useState<MisaListResult | null>(null);
	const [searchInput, setSearchInput] = useState("");
	const [filters, setFilters] = useState<MisaListFilters>({
		page: 1,
		pageSize: 50,
	});
	const [preview, setPreview] = useState<MisaImportPreview | null>(null);
	const [isReading, setIsReading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [importNotice, setImportNotice] = useState<string | null>(null);

	const load = useCallback(async () => {
		const requestId = ++requestIdRef.current;
		try {
			setError(null);
			const result = await misaRepository.list(filters);
			if (requestId === requestIdRef.current) setData(result);
		} catch (cause) {
			if (requestId === requestIdRef.current) {
				setError(
					cause instanceof Error
						? cause.message
						: "Không tải được dữ liệu MISA.",
				);
			}
		}
	}, [filters]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setFilters((current) => {
				if ((current.search ?? "") === searchInput) return current;
				return { ...current, search: searchInput, page: 1 };
			});
		}, 120);
		return () => window.clearTimeout(timer);
	}, [searchInput]);

	async function handleFile(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		setIsReading(true);
		setError(null);
		setImportNotice(null);
		try {
			const parsed = await parseMisaWorkbook(file);
			setPreview(await misaRepository.preview(parsed));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Không thể đọc file MISA đã chọn.",
			);
		} finally {
			setIsReading(false);
			event.target.value = "";
		}
	}

	async function confirmImport() {
		if (!preview) return;
		const result = await misaRepository.import(preview);
		setPreview(null);
		// Đổi bộ lọc đã tự tải lại danh sách; chỉ gọi tay khi đang ở trang 1.
		if (filters.page === 1) await load();
		else setFilters((current) => ({ ...current, page: 1 }));
		setImportNotice(
			result.inserted === 0 && result.duplicates > 0
				? "Không có dòng mới: toàn bộ dữ liệu đã tồn tại."
				: null,
		);
	}

	return (
		<>
			<section className="panel misa-import-card">
				<div className="misa-import-icon">
					<Database size={22} />
				</div>
				<div className="misa-import-copy">
					<h2>Dữ liệu bán hàng MISA</h2>
					{data?.lastImport ? (
						<p>
							<strong>{data.lastImport.fileName}</strong>
							<span>·</span> Nhập {formatDateTime(data.lastImport.importedAt)}
						</p>
					) : (
						<p>Chọn file Sổ chi tiết bán hàng xuất từ MISA.</p>
					)}
				</div>
				<input
					ref={inputRef}
					className="visually-hidden"
					type="file"
					accept=".xlsx,.xls"
					onChange={handleFile}
				/>
				<button
					className="button primary"
					type="button"
					disabled={isReading}
					onClick={() => inputRef.current?.click()}
				>
					<Upload size={16} />
					{isReading ? "Đang kiểm tra file..." : "Chọn file MISA"}
				</button>
			</section>

			{error && <Alert tone="error">{error}</Alert>}
			{importNotice && <Alert tone="info">{importNotice}</Alert>}

			{!data ? (
				<LoadingState />
			) : (
				<>
					<section className="stat-overview" aria-label="Tổng quan MISA">
						<article>
							<div className="stat-icon neutral">
								<FileSpreadsheet size={18} />
							</div>
							<span>Tổng dòng</span>
							<strong>{formatMoney(data.count)}</strong>
						</article>
						<article>
							<div className="stat-icon success">
								<PackageCheck size={18} />
							</div>
							<span>Tổng số lượng bán</span>
							<strong>{number.format(data.totalQuantity)}</strong>
						</article>
						<article>
							<div className="stat-icon info">
								<Building2 size={18} />
							</div>
							<span>Khách hàng</span>
							<strong>{formatMoney(data.customerCount)}</strong>
						</article>
						<article>
							<div className="stat-icon warning">
								<MapPinned size={18} />
							</div>
							<span>Tỉnh/Thành</span>
							<strong>{formatMoney(data.provinceCount)}</strong>
						</article>
					</section>

					<section className="panel misa-data-panel">
						<div className="misa-toolbar">
							<label className="misa-filter-field misa-search-field">
								<span>Tìm khách hàng</span>
								<div className="misa-filter-control">
									<Search size={16} />
									<input
										value={searchInput}
										placeholder="Nhập tên khách hàng..."
										onChange={(event) => setSearchInput(event.target.value)}
									/>
								</div>
							</label>
							<label className="misa-filter-field misa-province-field">
								<span>Tỉnh/Thành</span>
								<select
									value={filters.province ?? ""}
									onChange={(event) =>
										setFilters((current) => ({
											...current,
											province: event.target.value,
											page: 1,
										}))
									}
								>
									<option value="">Tất cả tỉnh/thành</option>
									{data.provinces.map((province) => (
										<option key={province} value={province}>
											{province}
										</option>
									))}
								</select>
							</label>
							<div className="misa-result-count">
								<span>Kết quả</span>
								<strong>{formatMoney(data.count)} dòng</strong>
							</div>
						</div>

						{data.items.length === 0 ? (
							<EmptyState>
								Chưa có dữ liệu phù hợp. Bấm “Chọn file MISA” để nhập dữ liệu.
							</EmptyState>
						) : (
							<div className="table-scroll misa-table-wrap">
								<table className="misa-table">
									<thead>
										<tr>
											<th className="misa-col-date">Ngày</th>
											<th className="misa-col-customer-code">Mã khách hàng</th>
											<th>Khách hàng</th>
											<th>Địa chỉ</th>
											<th>Mặt hàng</th>
											<th className="misa-col-quantity">Số lượng</th>
											<th className="misa-col-province">Tỉnh/ TP</th>
										</tr>
									</thead>
									<tbody>
										{data.items.map((row) => (
											<tr key={row.id}>
												<td className="misa-col-date">
													{formatDate(row.documentDate)}
												</td>
												<td className="misa-col-customer-code">
													{row.customerCode || "—"}
												</td>
												<td>
													<strong>{row.customerName}</strong>
												</td>
												<td className="misa-address-cell">
													{row.address || "—"}
												</td>
												<td className="misa-product-cell">
													{row.productName || "—"}
												</td>
												<td className="misa-col-quantity strong-number">
													{number.format(row.quantitySold)}
												</td>
												<td className="misa-col-province">
													{row.provinceCity || "—"}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}

						<footer className="misa-table-footer">
							<span>
								Trang <strong>{data.page}</strong>/{data.pageCount} · 50
								dòng/trang
							</span>
							<div>
								<button
									className="button secondary"
									type="button"
									disabled={data.page <= 1}
									onClick={() =>
										setFilters((current) => ({
											...current,
											page: data.page - 1,
										}))
									}
								>
									Trang trước
								</button>
								<button
									className="button secondary"
									type="button"
									disabled={data.page >= data.pageCount}
									onClick={() =>
										setFilters((current) => ({
											...current,
											page: data.page + 1,
										}))
									}
								>
									Trang sau
								</button>
							</div>
						</footer>
					</section>
				</>
			)}

			{preview && (
				<MisaImportPreviewDialog
					preview={preview}
					onClose={() => setPreview(null)}
					onConfirm={confirmImport}
				/>
			)}
		</>
	);
}
