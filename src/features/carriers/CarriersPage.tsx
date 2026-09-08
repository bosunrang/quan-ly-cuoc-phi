import {
	Building2,
	Check,
	ChevronLeft,
	ChevronRight,
	Download,
	Link2,
	MapPin,
	Plus,
	Search,
	SlidersHorizontal,
	Truck,
	Upload,
	UserMinus,
} from "lucide-react";
import {
	type ChangeEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	Carrier,
	CarrierExcelPreview,
	CarrierInput,
	CarrierListResult,
} from "../../domain/carriers/carrier.model";
import {
	emptyCarrierInput,
	toCarrierInput,
} from "../../domain/carriers/carrier.model";
import { carrierRepository } from "../../domain/carriers/carrier.repository";
import type {
	Customer,
	CustomerListResult,
} from "../../domain/customers/customer.model";
import { customerRepository } from "../../domain/customers/customer.repository";
import { normalizeText } from "../../shared/lib/text";
import { downloadXlsx } from "../../shared/lib/xlsx";
import { Alert } from "../../shared/ui/Alert";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { LoadingState } from "../../shared/ui/Panel";
import { StatusPill } from "../../shared/ui/StatusPill";
import { wideCarrierRateExport } from "./carrier-excel.export";
import {
	parseCarrierRateWorkbook,
	parseCarrierWorkbook,
} from "./carrier-excel.import";
import { CarrierCustomerRatesDialog } from "./components/CarrierCustomerRatesDialog";
import { CarrierDetailDialog } from "./components/CarrierDetailDialog";
import { CarrierDialog } from "./components/CarrierDialog";
import { CarrierExcelImportDialog } from "./components/CarrierExcelImportDialog";

interface EditorState {
	initial: CarrierInput;
	editingId: number | null;
}

const CARRIERS_PER_PAGE = 8;
const CUSTOMERS_PER_PAGE = 50;

function errorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
}

export function CarriersPage() {
	const [carrierData, setCarrierData] = useState<CarrierListResult | null>(
		null,
	);
	const [customerData, setCustomerData] = useState<CustomerListResult | null>(
		null,
	);
	const [assignedCustomers, setAssignedCustomers] = useState<Customer[]>([]);
	const [selectedCarrierId, setSelectedCarrierId] = useState<number | null>(
		null,
	);
	const [query, setQuery] = useState("");
	const [assignedQuery, setAssignedQuery] = useState("");
	const [customerPage, setCustomerPage] = useState(1);
	const [carrierQuery, setCarrierQuery] = useState("");
	const [carrierPage, setCarrierPage] = useState(1);
	const [checkedIds, setCheckedIds] = useState<number[]>([]);
	const [editor, setEditor] = useState<EditorState | null>(null);
	const [removing, setRemoving] = useState<Customer | null>(null);
	const [removingCarrier, setRemovingCarrier] = useState<Carrier | null>(null);
	const [detailCarrier, setDetailCarrier] = useState<Carrier | null>(null);
	const [rateCustomer, setRateCustomer] = useState<Customer | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [excelImporting, setExcelImporting] = useState<{
		fileName: string;
		kind: "carriers" | "rates";
		carriers: Awaited<ReturnType<typeof parseCarrierWorkbook>>;
		rates: Awaited<ReturnType<typeof parseCarrierRateWorkbook>>;
		preview: CarrierExcelPreview;
	} | null>(null);
	const [isExcelReading, setIsExcelReading] = useState(false);
	const carrierExcelInputRef = useRef<HTMLInputElement>(null);
	const rateExcelInputRef = useRef<HTMLInputElement>(null);
	const carrierRequest = useRef(0);
	const customerRequest = useRef(0);
	const assignedRequest = useRef(0);

	const load = useCallback(async () => {
		const requestId = carrierRequest.current + 1;
		carrierRequest.current = requestId;
		try {
			const nextCarriers = await carrierRepository.list();
			if (carrierRequest.current !== requestId) return;
			setError(null);
			setCarrierData(nextCarriers);
			setSelectedCarrierId((current) =>
				nextCarriers.items.some((carrier) => carrier.id === current)
					? current
					: (nextCarriers.items[0]?.id ?? null),
			);
		} catch (cause) {
			if (carrierRequest.current === requestId)
				setError(errorMessage(cause, "Không tải được dữ liệu nhà xe."));
		}
	}, []);

	const loadCustomerPage = useCallback(async () => {
		const requestId = customerRequest.current + 1;
		customerRequest.current = requestId;
		try {
			const result = await customerRepository.list(
				query,
				customerPage,
				CUSTOMERS_PER_PAGE,
			);
			if (customerRequest.current === requestId) setCustomerData(result);
		} catch (cause) {
			if (customerRequest.current === requestId)
				setError(errorMessage(cause, "Không tải được danh sách khách hàng."));
		}
	}, [customerPage, query]);

	const loadAssignedCustomers = useCallback(
		async (carrierId: number | null) => {
			const requestId = assignedRequest.current + 1;
			assignedRequest.current = requestId;
			if (!carrierId) {
				setAssignedCustomers([]);
				return;
			}
			try {
				const result = await carrierRepository.listAssignedCustomers(carrierId);
				if (assignedRequest.current === requestId)
					setAssignedCustomers(result.items);
			} catch (cause) {
				if (assignedRequest.current === requestId)
					setError(errorMessage(cause, "Không tải được khách hàng đã gán."));
			}
		},
		[],
	);

	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		void loadCustomerPage();
	}, [loadCustomerPage]);
	useEffect(() => {
		void loadAssignedCustomers(selectedCarrierId);
	}, [loadAssignedCustomers, selectedCarrierId]);

	const selectedCarrier =
		carrierData?.items.find((item) => item.id === selectedCarrierId) ?? null;
	const assignedIds = useMemo(
		() => new Set(selectedCarrier?.assignedCustomerIds ?? []),
		[selectedCarrier],
	);
	const customerPageCount = customerData?.pageCount ?? 1;
	const currentCustomerPage = customerData?.page ?? customerPage;
	const pagedCustomers = customerData?.items ?? [];
	const visibleAssignedCustomers = useMemo(() => {
		const keyword = normalizeText(assignedQuery);
		if (!keyword) return assignedCustomers;
		return assignedCustomers.filter((customer) =>
			normalizeText(
				`${customer.customerName} ${customer.recipient} ${customer.address}`,
			).includes(keyword),
		);
	}, [assignedCustomers, assignedQuery]);
	const visibleCarriers = useMemo(() => {
		const keyword = normalizeText(carrierQuery);
		const items = carrierData?.items ?? [];
		if (!keyword) return items;
		return items.filter((carrier) =>
			normalizeText(
				`${carrier.name} ${carrier.contact} ${carrier.phone}`,
			).includes(keyword),
		);
	}, [carrierData, carrierQuery]);
	const carrierPageCount = Math.max(
		1,
		Math.ceil(visibleCarriers.length / CARRIERS_PER_PAGE),
	);
	const currentCarrierPage = Math.min(carrierPage, carrierPageCount);
	const pagedCarriers = visibleCarriers.slice(
		(currentCarrierPage - 1) * CARRIERS_PER_PAGE,
		currentCarrierPage * CARRIERS_PER_PAGE,
	);

	const chooseCarrier = (carrierId: number) => {
		setSelectedCarrierId(carrierId);
		setAssignedCustomers([]);
		setCheckedIds([]);
		setQuery("");
		setCustomerPage(1);
		setAssignedQuery("");
		setRateCustomer(null);
	};
	const toggleCustomer = (customerId: number) => {
		if (assignedIds.has(customerId)) return;
		setCheckedIds((current) =>
			current.includes(customerId)
				? current.filter((id) => id !== customerId)
				: [...current, customerId],
		);
	};
	const save = async (input: CarrierInput) => {
		if (editor?.editingId)
			await carrierRepository.update(editor.editingId, input);
		else await carrierRepository.create(input);
		setEditor(null);
		await load();
	};
	const assignSelected = async () => {
		if (!selectedCarrier || !checkedIds.length) return;
		try {
			await carrierRepository.assignCustomers(selectedCarrier.id, checkedIds);
			setCheckedIds([]);
			await Promise.all([load(), loadAssignedCustomers(selectedCarrier.id)]);
		} catch (cause) {
			setError(errorMessage(cause, "Không gán được khách hàng."));
		}
	};
	const unassign = async (customer: Customer) => {
		if (!selectedCarrier) return;
		try {
			await carrierRepository.unassignCustomer(selectedCarrier.id, customer.id);
			setRemoving(null);
			if (rateCustomer?.id === customer.id) setRateCustomer(null);
			await Promise.all([load(), loadAssignedCustomers(selectedCarrier.id)]);
		} catch (cause) {
			setError(errorMessage(cause, "Không bỏ gán được khách hàng."));
		}
	};
	const handleExcelFile = async (
		event: ChangeEvent<HTMLInputElement>,
		kind: "carriers" | "rates",
	) => {
		const file = event.target.files?.[0];
		if (!file) return;
		setIsExcelReading(true);
		setError(null);
		try {
			const payload =
				kind === "carriers"
					? { carriers: await parseCarrierWorkbook(file), rates: [] }
					: { carriers: [], rates: await parseCarrierRateWorkbook(file) };
			const preview = await carrierRepository.excelPreview(
				payload.carriers,
				payload.rates,
			);
			setExcelImporting({ fileName: file.name, kind, preview, ...payload });
		} catch (cause) {
			setError(errorMessage(cause, "Không đọc được file Excel."));
		} finally {
			setIsExcelReading(false);
			event.target.value = "";
		}
	};
	const exportExcel = async () => {
		try {
			setError(null);
			const data = await carrierRepository.excelExport();
			const rateExport = wideCarrierRateExport(data.rates);
			downloadXlsx("Bang-cuoc-nha-xe.xlsx", [
				{
					name: "Nhà xe",
					headers: ["Nhà xe", "Địa chỉ", "Điện thoại"],
					rows: data.carriers.map((carrier) => [
						carrier.name,
						carrier.address,
						carrier.phone,
					]),
					widths: [28, 46, 24],
					yellowHeader: true,
				},
				{
					name: "Bảng cước",
					headers: [
						"Nhà xe",
						"Khách hàng",
						...rateExport.specs,
						"Phí vào cổng",
					],
					rows: rateExport.rows,
					widths: [28, 46, ...rateExport.specs.map(() => 18), 18],
					moneyColumns: [
						...rateExport.specs.map((_, index) => index + 2),
						rateExport.specs.length + 2,
					],
					yellowHeader: true,
				},
			]);
		} catch (cause) {
			setError(errorMessage(cause, "Không xuất được bảng cước Excel."));
		}
	};

	if (error && !carrierData) return <Alert tone="error">{error}</Alert>;
	if (!carrierData || !customerData) return <LoadingState />;

	return (
		<>
			{error && <Alert tone="error">{error}</Alert>}
			<section className="panel customer-import-card carrier-import-card">
				<div className="customer-import-icon">
					<Truck size={22} />
				</div>
				<div className="customer-import-copy">
					<h2>Dữ liệu nhà xe</h2>
					<p>
						Danh mục nhà xe và khách hàng được phép gửi hàng qua từng nhà xe.
					</p>
				</div>
				<input
					ref={carrierExcelInputRef}
					className="visually-hidden"
					type="file"
					accept=".xlsx,.xls"
					onChange={(event) => void handleExcelFile(event, "carriers")}
				/>
				<input
					ref={rateExcelInputRef}
					className="visually-hidden"
					type="file"
					accept=".xlsx,.xls"
					onChange={(event) => void handleExcelFile(event, "rates")}
				/>
				<div className="carrier-excel-actions">
					<button
						type="button"
						className="button secondary"
						onClick={() => void exportExcel()}
					>
						<Download size={16} /> Xuất Excel
					</button>
					<button
						type="button"
						className="button primary"
						disabled={isExcelReading}
						onClick={() => carrierExcelInputRef.current?.click()}
					>
						<Upload size={16} />{" "}
						{isExcelReading ? "Đang đọc file..." : "Nhập nhà xe"}
					</button>
					<button
						type="button"
						className="button primary"
						disabled={isExcelReading}
						onClick={() => rateExcelInputRef.current?.click()}
					>
						<Upload size={16} /> Nhập bảng cước
					</button>
				</div>
			</section>
			<section
				className="stat-overview carrier-overview"
				aria-label="Tổng quan nhà xe"
			>
				<article>
					<div className="stat-icon neutral">
						<Truck size={18} />
					</div>
					<span>Tổng nhà xe</span>
					<strong>{carrierData.items.length}</strong>
				</article>
				<article>
					<div className="stat-icon success">
						<Truck size={18} />
					</div>
					<span>Nhà xe hoạt động</span>
					<strong>{carrierData.activeCount}</strong>
				</article>
				<article>
					<div className="stat-icon info">
						<Link2 size={18} />
					</div>
					<span>Liên kết khách hàng</span>
					<strong>{carrierData.linkCount}</strong>
				</article>
				<article>
					<div className="stat-icon warning">
						<MapPin size={18} />
					</div>
					<span>Khách chưa gán</span>
					<strong>{carrierData.unassignedCustomerCount}</strong>
				</article>
			</section>
			<section className="carrier-board" aria-label="Gán khách hàng cho nhà xe">
				<aside className="panel carrier-list-panel">
					<header className="carrier-panel-head carrier-list-head">
						<div>
							<span>BƯỚC 1</span>
							<h2>Chọn nhà xe</h2>
							<p>Nhà xe đang hợp tác và trạng thái hoạt động</p>
						</div>
						<button
							className="carrier-header-add"
							type="button"
							onClick={() =>
								setEditor({ initial: emptyCarrierInput(), editingId: null })
							}
						>
							<Plus size={15} /> Thêm
						</button>
					</header>
					<label className="carrier-search carrier-list-search">
						<Search size={16} />
						<input
							value={carrierQuery}
							onChange={(event) => {
								setCarrierQuery(event.target.value);
								setCarrierPage(1);
							}}
							placeholder="Tìm nhà xe, liên hệ..."
						/>
					</label>
					<div className="carrier-list">
						{pagedCarriers.map((carrier) => (
							<article
								key={carrier.id}
								className={`carrier-choice ${carrier.id === selectedCarrierId ? "is-selected" : ""}`}
							>
								<button
									type="button"
									className="carrier-choice-select"
									onClick={() => chooseCarrier(carrier.id)}
								>
									<span className="carrier-choice-icon">
										<Truck size={17} />
									</span>
									<span className="carrier-choice-copy">
										<span className="carrier-choice-title">
											<strong>{carrier.name}</strong>
										</span>
										<span className="carrier-choice-meta">
											<small>
												{[carrier.contact, carrier.phone]
													.filter(Boolean)
													.join(" · ") || "Chưa có liên hệ"}
											</small>
										</span>
									</span>
								</button>
								<div className="carrier-actions">
									<button
										type="button"
										className="carrier-detail-button"
										title="Xem chi tiết"
										aria-label="Xem chi tiết"
										onClick={() => setDetailCarrier(carrier)}
									>
										<SlidersHorizontal size={15} />
									</button>
								</div>
								<span className="carrier-assigned-count">
									{carrier.assignedCustomerIds.length} khách hàng
								</span>
							</article>
						))}
						{visibleCarriers.length === 0 && (
							<p className="carrier-empty">Chưa có nhà xe nào.</p>
						)}
					</div>
					{visibleCarriers.length > CARRIERS_PER_PAGE && (
						<CarrierPagination
							className="carrier-pagination"
							label="Phân trang nhà xe"
							page={currentCarrierPage}
							pageCount={carrierPageCount}
							onPageChange={setCarrierPage}
						/>
					)}
				</aside>
				<section className="panel carrier-pool-panel">
					<header className="carrier-panel-head carrier-pool-head">
						<div>
							<span>BƯỚC 2</span>
							<h2>Chọn khách hàng để gán</h2>
							<p>
								{selectedCarrier
									? `Đánh dấu khách hàng có thể gửi qua ${selectedCarrier.name}`
									: "Hãy chọn nhà xe trước"}
							</p>
						</div>
						<strong>{customerData.resultCount} khách</strong>
					</header>
					<label className="carrier-search">
						<Search size={16} />
						<input
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setCustomerPage(1);
							}}
							placeholder="Tìm tên khách hàng hoặc địa chỉ..."
							disabled={!selectedCarrier}
						/>
					</label>
					<div className="carrier-customer-pool">
						{pagedCustomers.map((customer) => {
							const assigned = assignedIds.has(customer.id);
							const checked = checkedIds.includes(customer.id);
							return (
								<label
									key={customer.id}
									className={`carrier-customer-choice ${assigned ? "is-assigned" : ""} ${checked ? "is-checked" : ""}`}
								>
									<input
										type="checkbox"
										checked={checked}
										disabled={
											assigned || !selectedCarrier || !selectedCarrier.isActive
										}
										onChange={() => toggleCustomer(customer.id)}
									/>
									<span className="carrier-checkmark">
										{checked ? (
											<Check size={14} />
										) : assigned ? (
											<Link2 size={14} />
										) : null}
									</span>
									<span>
										<strong>{customer.customerName}</strong>
										<small>
											<MapPin size={12} />{" "}
											{customer.address || "Chưa có địa chỉ"}
										</small>
									</span>
									<StatusPill tone={assigned ? "success" : "neutral"}>
										{assigned ? "Đã gán" : "Sẵn sàng"}
									</StatusPill>
								</label>
							);
						})}
						{customerData.resultCount === 0 && (
							<p className="carrier-empty">
								Chưa có khách hàng trong danh mục.
							</p>
						)}
					</div>
					{customerData.pageCount > 1 && (
						<CarrierPagination
							className="carrier-customer-pagination"
							label="Phân trang khách hàng để gán"
							page={currentCustomerPage}
							pageCount={customerPageCount}
							onPageChange={setCustomerPage}
						/>
					)}
					<footer className="carrier-selection-bar">
						<span>
							{checkedIds.length
								? `${checkedIds.length} khách hàng đã chọn`
								: "Chưa chọn khách hàng nào"}
						</span>
						<button
							className="button primary"
							type="button"
							disabled={!checkedIds.length || !selectedCarrier?.isActive}
							onClick={() => void assignSelected()}
						>
							Gán cho {selectedCarrier?.name ?? "nhà xe"}
						</button>
					</footer>
				</section>
				<aside className="panel carrier-assigned-panel">
					<header className="carrier-panel-head">
						<span>DANH SÁCH</span>
						<h2>Khách hàng được gán</h2>
						<p>Danh sách được dùng để lập bảng cước</p>
					</header>
					<label className="carrier-search carrier-assigned-search">
						<Search size={16} />
						<input
							value={assignedQuery}
							onChange={(event) => setAssignedQuery(event.target.value)}
							placeholder="Tìm khách hàng đã gán..."
							disabled={!selectedCarrier || !assignedCustomers.length}
						/>
					</label>
					<div className="carrier-assigned-list">
						{visibleAssignedCustomers.map((customer) => (
							<article key={customer.id}>
								<span>
									<Building2 size={16} />
								</span>
								<div>
									<strong>{customer.customerName}</strong>
									<small>{customer.address || "Chưa có địa chỉ"}</small>
								</div>
								<div className="carrier-assigned-actions">
									<button
										type="button"
										className="carrier-rate-button"
										title="Thiết lập bảng cước"
										aria-label={`Thiết lập bảng cước cho ${customer.customerName}`}
										onClick={() => setRateCustomer(customer)}
									>
										<SlidersHorizontal size={16} />
									</button>
									<button
										type="button"
										title="Bỏ gán"
										aria-label={`Bỏ gán ${customer.customerName}`}
										onClick={() => setRemoving(customer)}
									>
										<UserMinus size={16} />
									</button>
								</div>
							</article>
						))}
						{selectedCarrier && !assignedCustomers.length && (
							<p className="carrier-empty">
								Nhà xe này chưa được gán khách hàng.
							</p>
						)}
						{selectedCarrier &&
							assignedCustomers.length > 0 &&
							visibleAssignedCustomers.length === 0 && (
								<p className="carrier-empty">
									Không tìm thấy khách hàng được gán phù hợp.
								</p>
							)}
					</div>
				</aside>
			</section>
			{editor && (
				<CarrierDialog
					initial={editor.initial}
					editingId={editor.editingId}
					onSave={save}
					onClose={() => setEditor(null)}
				/>
			)}
			{detailCarrier && (
				<CarrierDetailDialog
					carrier={detailCarrier}
					onClose={() => setDetailCarrier(null)}
					onEdit={() => {
						setEditor({
							initial: toCarrierInput(detailCarrier),
							editingId: detailCarrier.id,
						});
						setDetailCarrier(null);
					}}
					onDelete={() => {
						setRemovingCarrier(detailCarrier);
						setDetailCarrier(null);
					}}
				/>
			)}
			{selectedCarrier && rateCustomer && (
				<CarrierCustomerRatesDialog
					carrier={selectedCarrier}
					customer={rateCustomer}
					onClose={() => setRateCustomer(null)}
				/>
			)}
			{excelImporting && (
				<CarrierExcelImportDialog
					fileName={excelImporting.fileName}
					kind={excelImporting.kind}
					preview={excelImporting.preview}
					onClose={() => setExcelImporting(null)}
					onConfirm={async () => {
						await carrierRepository.excelImport(
							excelImporting.carriers,
							excelImporting.rates,
						);
						setExcelImporting(null);
						setCheckedIds([]);
						await Promise.all([
							load(),
							loadAssignedCustomers(selectedCarrierId),
						]);
					}}
				/>
			)}
			{removing && (
				<ConfirmDialog
					title="Bỏ gán khách hàng"
					message={`Bỏ “${removing.customerName}” khỏi ${selectedCarrier?.name}? Bảng cước sau này sẽ không còn được áp dụng cho cặp này.`}
					confirmLabel="Bỏ gán"
					onConfirm={() => unassign(removing)}
					onClose={() => setRemoving(null)}
				/>
			)}
			{removingCarrier && (
				<ConfirmDialog
					title="Xóa nhà xe"
					message={`Xóa “${removingCarrier.name}” khỏi danh sách? Các liên kết khách hàng của nhà xe này cũng sẽ được gỡ.`}
					onConfirm={async () => {
						await carrierRepository.remove(removingCarrier.id);
						if (selectedCarrierId === removingCarrier.id)
							setSelectedCarrierId(null);
						setRemovingCarrier(null);
						await load();
					}}
					onClose={() => setRemovingCarrier(null)}
				/>
			)}
		</>
	);
}

function CarrierPagination({
	className,
	label,
	page,
	pageCount,
	onPageChange,
}: {
	className: string;
	label: string;
	page: number;
	pageCount: number;
	onPageChange: (page: number) => void;
}) {
	return (
		<nav className={className} aria-label={label}>
			<button
				type="button"
				title="Trang trước"
				disabled={page === 1}
				onClick={() => onPageChange(Math.max(1, page - 1))}
			>
				<ChevronLeft size={16} />
			</button>
			<span>
				Trang {page}/{pageCount}
			</span>
			<button
				type="button"
				title="Trang sau"
				disabled={page === pageCount}
				onClick={() => onPageChange(Math.min(pageCount, page + 1))}
			>
				<ChevronRight size={16} />
			</button>
		</nav>
	);
}
