import {
	ChevronLeft,
	ChevronRight,
	Pencil,
	Plus,
	Search,
	Trash2,
	Truck,
	UserRoundCheck,
	WalletCards,
} from "lucide-react";
import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	Entry,
	EntryFilters,
	EntryFormOptions,
	EntryInput,
	EntryListResult,
} from "../../domain/entries/entry.model";
import {
	emptyEntryInput,
	toEntryInput,
} from "../../domain/entries/entry.model";
import { entryRepository } from "../../domain/entries/entry.repository";
import { formatDate, formatMoney, todayIso } from "../../shared/lib/format";
import { Alert } from "../../shared/ui/Alert";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { DateInput } from "../../shared/ui/DateInput/DateInput";
import { EmptyState, LoadingState } from "../../shared/ui/Panel";
import { EntryDialog } from "./components/EntryDialog";

interface EditorState {
	initial: EntryInput;
	editingId: number | null;
}

const ENTRY_DATE_DRAFT_KEY = "cuocphi.entry-date-draft";
const ENTRY_PAGE_SIZE = 25;

function initialEntryDate(): string {
	const saved = sessionStorage.getItem(ENTRY_DATE_DRAFT_KEY) ?? "";
	return /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : todayIso();
}

export function EntriesPage() {
	const [data, setData] = useState<EntryListResult | null>(null);
	const [options, setOptions] = useState<EntryFormOptions | null>(null);
	const [filters, setFilters] = useState<EntryFilters>({});
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const [editor, setEditor] = useState<EditorState | null>(null);
	const [removing, setRemoving] = useState<Entry | null>(null);
	const [draftEntryDate, setDraftEntryDate] = useState(initialEntryDate);
	const deferredSearch = useDeferredValue(filters.search ?? "");
	const listFilters = useMemo<EntryFilters>(
		() => ({
			...filters,
			search: deferredSearch || undefined,
			limit: String(ENTRY_PAGE_SIZE),
			offset: String((page - 1) * ENTRY_PAGE_SIZE),
		}),
		[deferredSearch, filters, page],
	);
	const loadRequest = useRef(0);
	const rememberEntryDate = (entryDate: string) => {
		setDraftEntryDate(entryDate);
		sessionStorage.setItem(ENTRY_DATE_DRAFT_KEY, entryDate);
	};
	const updateFilters = (patch: Partial<EntryFilters>) => {
		setPage(1);
		setFilters((current) => ({ ...current, ...patch }));
	};
	const load = useCallback(async () => {
		const requestId = loadRequest.current + 1;
		loadRequest.current = requestId;
		try {
			const result = await entryRepository.list(listFilters);
			if (loadRequest.current !== requestId) return;
			setError(null);
			setData(result);
		} catch (cause) {
			if (loadRequest.current !== requestId) return;
			setError(
				cause instanceof Error ? cause.message : "Không tải được phiếu.",
			);
		}
	}, [listFilters]);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		void entryRepository
			.formOptions()
			.then(setOptions)
			.catch(() => setOptions(null));
	}, []);
	const save = async (input: EntryInput) => {
		if (editor?.editingId)
			await entryRepository.update(editor.editingId, input);
		else await entryRepository.create(input);
		setEditor(null);
		await load();
	};
	if (!data)
		return error ? <Alert tone="error">{error}</Alert> : <LoadingState />;
	const isAdmin = data.scope === "all";
	const pageCount = Math.max(1, Math.ceil(data.count / ENTRY_PAGE_SIZE));
	const selectedEmployee = options?.employees.find(
		(employee) => employee.id === Number(filters.employeeId),
	);
	const subtitle = selectedEmployee
		? `Đang kiểm tra cước của ${selectedEmployee.name}`
		: isAdmin
			? "Theo dõi cước của tất cả nhân viên"
			: "Các phiếu cước do bạn nhập";
	return (
		<>
			<section className="panel entry-intro">
				<div className="entry-intro-icon">
					<Truck size={22} />
				</div>
				<div>
					<h2>Nhập chi phí gửi hàng</h2>
					<p>{subtitle}</p>
				</div>
				<button
					type="button"
					className="button primary"
					onClick={() =>
						setEditor({
							initial: emptyEntryInput(draftEntryDate),
							editingId: null,
						})
					}
				>
					<Plus size={16} /> Thêm chi phí
				</button>
			</section>
			{error && <Alert tone="error">{error}</Alert>}
			<section
				className="stat-overview entry-overview"
				aria-label="Tổng quan chi phí"
			>
				<article>
					<div className="stat-icon neutral">
						<Truck size={18} />
					</div>
					<span>Phiếu cước</span>
					<strong>{data.count}</strong>
				</article>
				<article>
					<div className="stat-icon success">
						<WalletCards size={18} />
					</div>
					<span>Tổng chi phí</span>
					<strong>{formatMoney(data.total)} đ</strong>
				</article>
				<article>
					<div className="stat-icon info">
						<UserRoundCheck size={18} />
					</div>
					<span>Đang xem</span>
					<strong>
						{selectedEmployee?.name ?? (isAdmin ? "Tất cả" : "Của bạn")}
					</strong>
				</article>
			</section>
			<section className="panel entry-data-panel">
				{isAdmin && (
					<div className="entry-employee-filter">
						<div>
							<strong>Kiểm tra cước theo nhân viên</strong>
							<span>Chọn một nhân viên để lọc danh sách và tổng chi phí.</span>
						</div>
						<label className="entry-employee-select">
							<span className="visually-hidden">Nhân viên phụ trách</span>
							<select
								value={filters.employeeId ?? ""}
								onChange={(event) =>
									updateFilters({ employeeId: event.target.value || undefined })
								}
							>
								<option value="">Tất cả nhân viên</option>
								{options?.employees.map((employee) => (
									<option key={employee.id} value={employee.id}>
										{employee.name}
									</option>
								))}
							</select>
						</label>
					</div>
				)}
				<div className="entry-toolbar">
					<label className="entry-search-field">
						<span>Tìm phiếu</span>
						<div>
							<Search size={16} />
							<input
								value={filters.search ?? ""}
								placeholder="Khách hàng, nhà xe, người nhận..."
								onChange={(event) =>
									updateFilters({ search: event.target.value })
								}
							/>
						</div>
					</label>
					<label className="entry-date-filter" htmlFor="entry-filter-from">
						<span>Từ ngày</span>
						<DateInput
							id="entry-filter-from"
							value={filters.from ?? ""}
							ariaLabel="Từ ngày"
							onChange={(from) => updateFilters({ from: from || undefined })}
						/>
					</label>
					<label className="entry-date-filter" htmlFor="entry-filter-to">
						<span>Đến ngày</span>
						<DateInput
							id="entry-filter-to"
							value={filters.to ?? ""}
							ariaLabel="Đến ngày"
							onChange={(to) => updateFilters({ to: to || undefined })}
						/>
					</label>
				</div>
				{data.items.length === 0 ? (
					<EmptyState>
						Chưa có phiếu cước phù hợp với điều kiện đang chọn.
					</EmptyState>
				) : (
					<>
						<div className="table-scroll entry-list-table-wrap">
							<table
								className={`entry-list-table${isAdmin ? " is-admin" : ""}`}
							>
								<thead>
									<tr>
										<th>Ngày gửi</th>
										<th>Tên khách hàng</th>
										<th>Tên chành xe</th>
										<th>Người nhận hàng</th>
										<th>Quy cách</th>
										<th>Cước phí</th>
										<th>Phí vào cổng</th>
										{isAdmin && <th>Nhân viên phụ trách</th>}
										<th className="entry-note-heading">Ghi chú</th>
										<th>Thao tác</th>
									</tr>
								</thead>
								<tbody>
									{data.items.map((entry) => {
										const standardTransportFee = entry.standardTransportFee;
										const rateDifference =
											standardTransportFee == null
												? null
												: entry.transportFee - standardTransportFee;
										const rateTone =
											rateDifference == null || rateDifference === 0
												? ""
												: rateDifference > 0
													? " is-over-rate"
													: " is-under-rate";
										return (
											<tr key={entry.id}>
												<td>{formatDate(entry.entryDate)}</td>
												<td>
													<strong>{entry.customer}</strong>
												</td>
												<td>{entry.carrier}</td>
												<td>{entry.recipient || "—"}</td>
												<td>{entry.spec || "—"}</td>
												<td className={`entry-money${rateTone}`}>
													{formatMoney(entry.transportFee)}
												</td>
												<td className="entry-money">
													{entry.gateFee ? formatMoney(entry.gateFee) : "—"}
												</td>
												{isAdmin && <td>{entry.employeeName || "Chưa gán"}</td>}
												<td className="entry-note-cell">{entry.note || "—"}</td>
												<td>
													<div className="entry-row-actions">
														<button
															type="button"
															className="row-action"
															title="Sửa phiếu"
															aria-label="Sửa phiếu"
															onClick={() =>
																setEditor({
																	initial: toEntryInput(entry),
																	editingId: entry.id,
																})
															}
														>
															<Pencil size={14} />
														</button>
														<button
															type="button"
															className="row-action is-danger"
															title="Xóa phiếu"
															aria-label="Xóa phiếu"
															onClick={() => setRemoving(entry)}
														>
															<Trash2 size={14} />
														</button>
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
						{pageCount > 1 && (
							<nav
								className="entry-pagination"
								aria-label="Phân trang phiếu cước"
							>
								<button
									type="button"
									title="Trang trước"
									aria-label="Trang trước"
									disabled={page === 1}
									onClick={() => setPage((current) => Math.max(1, current - 1))}
								>
									<ChevronLeft size={16} />
								</button>
								<span>
									Trang {page}/{pageCount}
								</span>
								<button
									type="button"
									className="button secondary"
									title="Trang sau"
									aria-label="Trang sau"
									disabled={page === pageCount}
									onClick={() =>
										setPage((current) => Math.min(pageCount, current + 1))
									}
								>
									<ChevronRight size={16} />
								</button>
							</nav>
						)}
					</>
				)}
			</section>
			{editor && (
				<EntryDialog
					initial={editor.initial}
					editingId={editor.editingId}
					formOptions={options}
					onEntryDateChange={editor.editingId ? undefined : rememberEntryDate}
					onSave={save}
					onClose={() => setEditor(null)}
				/>
			)}
			{removing && (
				<ConfirmDialog
					title="Xóa phiếu cước"
					message={`Xóa phiếu ngày ${formatDate(removing.entryDate)} — ${removing.customer}? Việc này không hoàn tác được.`}
					onConfirm={async () => {
						await entryRepository.remove(removing.id);
						setRemoving(null);
						await load();
					}}
					onClose={() => setRemoving(null)}
				/>
			)}
		</>
	);
}
