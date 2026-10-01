import {
	Building2,
	ChevronLeft,
	ChevronRight,
	MapPinned,
	Pencil,
	Plus,
	Search,
	Trash2,
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
	Customer,
	CustomerInput,
	CustomerListResult,
} from "../../domain/customers/customer.model";
import {
	emptyCustomerInput,
	toCustomerInput,
} from "../../domain/customers/customer.model";
import { customerRepository } from "../../domain/customers/customer.repository";
import { Alert } from "../../shared/ui/Alert";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { EmptyState, LoadingState } from "../../shared/ui/Panel";
import { CustomerDialog } from "./components/CustomerDialog";
import { CustomerImportDialog } from "./components/CustomerImportDialog";
import {
	type CustomerImportPreview,
	parseCustomerWorkbook,
} from "./customer.import";

interface EditorState {
	initial: CustomerInput;
	editingId: number | null;
}

export function CustomersPage() {
	const [data, setData] = useState<CustomerListResult | null>(null);
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [editor, setEditor] = useState<EditorState | null>(null);
	const [removing, setRemoving] = useState<Customer | null>(null);
	const [importing, setImporting] = useState<{
		fileName: string;
		preview: CustomerImportPreview;
	} | null>(null);
	const [isReading, setIsReading] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const requestIdRef = useRef(0);

	const load = useCallback(async () => {
		const requestId = ++requestIdRef.current;
		try {
			setError(null);
			const result = await customerRepository.list(search, page);
			if (requestId === requestIdRef.current) setData(result);
		} catch (cause) {
			if (requestId === requestIdRef.current) {
				setError(
					cause instanceof Error ? cause.message : "Không tải được khách hàng.",
				);
			}
		}
	}, [page, search]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(
		() => () => {
			requestIdRef.current += 1;
		},
		[],
	);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setSearch(searchInput);
			setPage(1);
		}, 120);
		return () => window.clearTimeout(timer);
	}, [searchInput]);

	const save = async (input: CustomerInput) => {
		if (editor?.editingId)
			await customerRepository.update(editor.editingId, input);
		else await customerRepository.create(input);
		setEditor(null);
		await load();
	};

	const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		setIsReading(true);
		setError(null);
		setNotice(null);
		try {
			const existingKeys = await customerRepository.importKeys();
			setImporting({
				fileName: file.name,
				preview: await parseCustomerWorkbook(file, existingKeys),
			});
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Không đọc được file khách hàng.",
			);
		} finally {
			setIsReading(false);
			event.target.value = "";
		}
	};

	return (
		<>
			<section className="panel customer-import-card">
				<div className="customer-import-icon">
					<Building2 size={22} />
				</div>
				<div className="customer-import-copy">
					<h2>Dữ liệu khách hàng</h2>
					<p>Danh mục thông tin giao nhận dùng chung cho mọi phiếu cước.</p>
				</div>
				<div className="customer-import-actions">
					<input
						ref={inputRef}
						className="visually-hidden"
						type="file"
						accept=".xlsx,.xls"
						onChange={handleFile}
					/>
					<button
						type="button"
						className="button secondary"
						disabled={isReading}
						onClick={() => inputRef.current?.click()}
					>
						<Upload size={16} />{" "}
						{isReading ? "Đang đọc file..." : "Nhập từ Excel"}
					</button>
					<button
						type="button"
						className="button primary"
						onClick={() =>
							setEditor({ initial: emptyCustomerInput(), editingId: null })
						}
					>
						<Plus size={16} /> Thêm khách hàng
					</button>
				</div>
			</section>

			{error && <Alert tone="error">{error}</Alert>}
			{notice && <Alert tone="success">{notice}</Alert>}

			{!data ? (
				<LoadingState />
			) : (
				<>
					<section
						className="stat-overview customer-stat-overview"
						aria-label="Tổng quan khách hàng"
					>
						<article>
							<div className="stat-icon neutral">
								<Building2 size={18} />
							</div>
							<span>Tổng khách hàng</span>
							<strong>{data.count}</strong>
						</article>
						<article>
							<div className="stat-icon success">
								<Building2 size={18} />
							</div>
							<span>Nhà xe liên kết</span>
							<strong>{data.carrierCount}</strong>
						</article>
						<article>
							<div className="stat-icon warning">
								<MapPinned size={18} />
							</div>
							<span>Địa chỉ giao hàng</span>
							<strong>{data.addressCount}</strong>
						</article>
					</section>

					<section className="panel customer-data-panel">
						<div className="customer-toolbar">
							<label className="customer-filter-field customer-search-field">
								<span>Tìm khách hàng</span>
								<div className="customer-filter-control">
									<Search size={16} />
									<input
										value={searchInput}
										placeholder="Nhập tên, mã khách hàng, nhà xe..."
										onChange={(event) => setSearchInput(event.target.value)}
									/>
								</div>
							</label>
							<div className="customer-result-count">
								<span>Kết quả</span>
								<strong>{data.resultCount} khách hàng</strong>
							</div>
						</div>

						{data.items.length === 0 ? (
							<EmptyState>
								{search.trim()
									? "Không tìm thấy khách hàng phù hợp."
									: "Chưa có khách hàng nào. Bấm “Thêm khách hàng” để bắt đầu."}
							</EmptyState>
						) : (
							<div className="table-scroll customer-table-wrap">
								<table className="customer-table">
									<thead>
										<tr>
											<th className="customer-order">STT</th>
											<th className="customer-code">Mã khách hàng</th>
											<th>Tên khách hàng</th>
											<th>Nhà xe</th>
											<th>Địa chỉ giao hàng</th>
											<th className="customer-actions">Thao tác</th>
										</tr>
									</thead>
									<tbody>
										{data.items.map((customer, index) => (
											<tr key={customer.id}>
												<td className="customer-order">
													{(data.page - 1) * data.pageSize + index + 1}
												</td>
												<td className="customer-code">
													{customer.customerCode || "—"}
												</td>
												<td className="customer-name">
													<strong>{customer.customerName}</strong>
												</td>
												<td>{customer.carrier || "—"}</td>
												<td className="customer-address">
													{customer.address || "—"}
												</td>
												<td className="customer-actions">
													<div className="inline-actions">
														<button
															type="button"
															className="row-action"
															title="Sửa khách hàng"
															onClick={() =>
																setEditor({
																	initial: toCustomerInput(customer),
																	editingId: customer.id,
																})
															}
														>
															<Pencil size={14} />
														</button>
														<button
															type="button"
															className="row-action is-danger"
															title="Xóa khách hàng"
															onClick={() => setRemoving(customer)}
														>
															<Trash2 size={14} />
														</button>
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
						{data.pageCount > 1 && (
							<nav
								className="customer-pagination"
								aria-label="Phân trang khách hàng"
							>
								<button
									type="button"
									title="Trang trước"
									disabled={data.page === 1}
									onClick={() => setPage((current) => Math.max(1, current - 1))}
								>
									<ChevronLeft size={16} />
								</button>
								<span>
									Trang {data.page}/{data.pageCount}
								</span>
								<button
									type="button"
									title="Trang sau"
									disabled={data.page === data.pageCount}
									onClick={() =>
										setPage((current) => Math.min(data.pageCount, current + 1))
									}
								>
									<ChevronRight size={16} />
								</button>
							</nav>
						)}
					</section>
				</>
			)}

			{editor && (
				<CustomerDialog
					initial={editor.initial}
					editingId={editor.editingId}
					onSave={save}
					onClose={() => setEditor(null)}
				/>
			)}
			{importing && (
				<CustomerImportDialog
					fileName={importing.fileName}
					preview={importing.preview}
					onClose={() => setImporting(null)}
					onConfirm={async () => {
						const rows = importing.preview.rows.filter(
							(row) => row.status === "ready" || row.status === "update",
						);
						const result = await customerRepository.import(rows);
						setImporting(null);
						await load();
						setNotice(
							`Đã thêm ${result.inserted}, cập nhật ${result.updated} khách hàng theo mã; bỏ qua ${result.duplicates} dòng trùng.`,
						);
					}}
				/>
			)}
			{removing && (
				<ConfirmDialog
					title="Xóa khách hàng"
					message={`Xóa “${removing.customerName}” khỏi danh sách? Việc này không làm thay đổi các phiếu cước đã lập.`}
					onConfirm={async () => {
						await customerRepository.remove(removing.id);
						setRemoving(null);
						await load();
					}}
					onClose={() => setRemoving(null)}
				/>
			)}
		</>
	);
}
