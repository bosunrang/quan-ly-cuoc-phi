import { AlertCircle, PackageSearch } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type {
	EntryCarrierChoice,
	EntryCustomerContext,
	EntryFormOptions,
	EntryInput,
	EntryRate,
	EntryRateChoice,
	MisaOrder,
} from "../../../domain/entries/entry.model";
import {
	defaultEntryRecipient,
	entryCarrierOptions,
	entryRateOptions,
	validateEntry,
} from "../../../domain/entries/entry.model";
import { entryRepository } from "../../../domain/entries/entry.repository";
import { formatDate, formatMoney } from "../../../shared/lib/format";
import { Alert } from "../../../shared/ui/Alert";
import { DateInput } from "../../../shared/ui/DateInput/DateInput";
import { Dialog } from "../../../shared/ui/Dialog";
import { Field, FieldGrid } from "../../../shared/ui/Field";
import { MoneyInput } from "../../../shared/ui/MoneyInput";

interface Props {
	initial: EntryInput;
	editingId: number | null;
	formOptions?: EntryFormOptions | null;
	onEntryDateChange?: (entryDate: string) => void;
	onSave: (input: EntryInput) => Promise<void>;
	onClose: () => void;
}

const ENTRY_EMPLOYEE_DRAFT_KEY = "cuocphi.entry-employee-draft";

function savedEmployeeId(
	employees: EntryFormOptions["employees"],
): number | undefined {
	const value = Number(sessionStorage.getItem(ENTRY_EMPLOYEE_DRAFT_KEY));
	return employees.some((employee) => employee.id === value)
		? value
		: undefined;
}

function normalizeCustomerSearch(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[đĐ]/g, "d")
		.toLocaleLowerCase("vi-VN");
}

function rateForSpec(rates: EntryRate[], spec: string): EntryRate | null {
	const specKey = normalizeCustomerSearch(spec);
	if (!specKey) return null;
	return (
		rates.find((item) => normalizeCustomerSearch(item.spec) === specKey) ??
		rates.find((item) => item.isDefault) ??
		null
	);
}

function CarrierOptionGroup({
	label,
	options,
	onChoose,
}: {
	label: string;
	options: EntryCarrierChoice[];
	onChoose: (id: number) => void;
}) {
	if (!options.length) return null;
	return (
		<div className="entry-delivery-option-group">
			<span className="entry-delivery-option-label">{label}</span>
			{options.map((carrier) => (
				<button
					key={carrier.id}
					type="button"
					role="option"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onChoose(carrier.id)}
				>
					<span>{carrier.name}</span>
					{carrier.isLinked && <small>Đã liên kết</small>}
				</button>
			))}
		</div>
	);
}

function RateOptionGroup({
	label,
	options,
	onChoose,
}: {
	label: string;
	options: EntryRateChoice[];
	onChoose: (rate: EntryRateChoice) => void;
}) {
	if (!options.length) return null;
	return (
		<div className="entry-delivery-option-group">
			<span className="entry-delivery-option-label">{label}</span>
			{options.map((rate) => (
				<button
					key={rate.id}
					type="button"
					role="option"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onChoose(rate)}
				>
					<span>{rate.spec}</span>
					{rate.isAssigned && <small>Đã gán</small>}
				</button>
			))}
		</div>
	);
}

export function EntryDialog({
	initial,
	editingId,
	formOptions = null,
	onEntryDateChange,
	onSave,
	onClose,
}: Props) {
	const [form, setForm] = useState<EntryInput>(initial);
	const [options, setOptions] = useState<EntryFormOptions | null>(formOptions);
	const [customerId, setCustomerId] = useState<number | null>(null);
	const [customerSearch, setCustomerSearch] = useState(initial.customer);
	const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
	const customerRequest = useRef(0);
	const ordersRequest = useRef(0);
	const ratesRequest = useRef(0);
	const [carrierId, setCarrierId] = useState<number | null>(null);
	const [carrierPickerOpen, setCarrierPickerOpen] = useState(false);
	const [recipientOptionsOpen, setRecipientOptionsOpen] = useState(false);
	const [rateOptionsOpen, setRateOptionsOpen] = useState(false);
	const [context, setContext] = useState<EntryCustomerContext | null>(null);
	const [orders, setOrders] = useState<MisaOrder[]>([]);
	const [rates, setRates] = useState<EntryRate[]>([]);
	const [rate, setRate] = useState<EntryRate | null>(null);
	const [error, setError] = useState<string | null>(null);
	const deferredCustomerSearch = useDeferredValue(customerSearch);
	const deferredCarrierSearch = useDeferredValue(form.carrier);
	const deferredRateSearch = useDeferredValue(form.spec);

	useEffect(() => {
		void (
			formOptions ? Promise.resolve(formOptions) : entryRepository.formOptions()
		)
			.then((result) => {
				setOptions(result);
				if (!editingId)
					setForm((current) => ({
						...current,
						employeeId: result.isAdmin
							? (current.employeeId ?? savedEmployeeId(result.employees))
							: result.employees.find(
									(employee) => employee.userId === result.currentUserId,
								)?.id,
					}));
				const existing = result.customers.find(
					(item) => item.name === initial.customer,
				);
				if (existing) setCustomerId(existing.id);
			})
			.catch((cause) =>
				setError(
					cause instanceof Error
						? cause.message
						: "Không tải được dữ liệu nhập phiếu.",
				),
			);
	}, [editingId, formOptions, initial.customer]);
	const customerSearchIndex = useMemo(
		() =>
			(options?.customers ?? []).map((customer) => ({
				customer,
				searchKey: normalizeCustomerSearch(
					`${customer.name} ${customer.provinceCity}`,
				),
			})),
		[options?.customers],
	);
	const matchingCustomers = useMemo(() => {
		const query = normalizeCustomerSearch(deferredCustomerSearch.trim());
		return customerSearchIndex
			.filter((item) => !query || item.searchKey.includes(query))
			.slice(0, 20)
			.map((item) => item.customer);
	}, [customerSearchIndex, deferredCustomerSearch]);
	const carrierOptions = useMemo(
		() => entryCarrierOptions(options?.carriers ?? [], context),
		[context, options?.carriers],
	);
	const matchingCarriers = useMemo(() => {
		const query = normalizeCustomerSearch(deferredCarrierSearch.trim());
		return carrierOptions
			.filter(
				(carrier) =>
					!query || normalizeCustomerSearch(carrier.name).includes(query),
			)
			.slice(0, 20);
	}, [carrierOptions, deferredCarrierSearch]);
	const linkedCarriers = matchingCarriers.filter((carrier) => carrier.isLinked);
	const otherCarriers = matchingCarriers.filter((carrier) => !carrier.isLinked);
	const recipientOptions =
		(context?.recipients.length ?? 0) >= 2 ? (context?.recipients ?? []) : [];
	const rateOptions = useMemo(() => entryRateOptions(rates), [rates]);
	const matchingRateOptions = useMemo(() => {
		const query = normalizeCustomerSearch(deferredRateSearch.trim());
		return rateOptions.filter(
			(rateOption) =>
				!query || normalizeCustomerSearch(rateOption.spec).includes(query),
		);
	}, [deferredRateSearch, rateOptions]);
	const assignedRateOptions = matchingRateOptions.filter(
		(rateOption) => rateOption.isAssigned,
	);
	const newRateOptions = matchingRateOptions.filter(
		(rateOption) => !rateOption.isAssigned,
	);

	const loadOrders = async (id: number, date: string) => {
		const requestId = ordersRequest.current + 1;
		ordersRequest.current = requestId;
		try {
			const result = await entryRepository.misaOrders(id, date);
			if (ordersRequest.current === requestId) setOrders(result.items);
		} catch (cause) {
			if (ordersRequest.current === requestId)
				setError(
					cause instanceof Error ? cause.message : "Không tải được đơn MISA.",
				);
		}
	};
	const loadRates = async (nextCustomerId: number, nextCarrierId: number) => {
		const requestId = ratesRequest.current + 1;
		ratesRequest.current = requestId;
		try {
			const result = await entryRepository.rates(nextCustomerId, nextCarrierId);
			if (ratesRequest.current === requestId) setRates(result.items);
		} catch (cause) {
			if (ratesRequest.current === requestId) {
				setRates([]);
				setError(
					cause instanceof Error ? cause.message : "Không tải được bảng cước.",
				);
			}
		}
	};
	const chooseCustomer = async (id: number, preserveSearch = false) => {
		if (!id) {
			customerRequest.current += 1;
			ordersRequest.current += 1;
			ratesRequest.current += 1;
			setCustomerId(null);
			setCarrierId(null);
			setContext(null);
			setOrders([]);
			setRates([]);
			setRate(null);
			setForm((current) => ({
				...current,
				customerId: undefined,
				customer: "",
				carrier: "",
				recipient: "",
				address: "",
				spec: "",
				saveCarrierRate: false,
			}));
			if (!preserveSearch) setCustomerSearch("");
			return;
		}
		const requestId = customerRequest.current + 1;
		customerRequest.current = requestId;
		ordersRequest.current += 1;
		ratesRequest.current += 1;
		const selected = options?.customers.find((item) => item.id === id);
		try {
			setError(null);
			setCustomerId(id);
			setCarrierId(null);
			setContext(null);
			setOrders([]);
			setRates([]);
			setRate(null);
			setForm((current) => ({
				...current,
				customerId: id,
				customer: selected?.name ?? current.customer,
				recipient: "",
				address: "",
				carrier: "",
				spec: "",
				saveCarrierRate: false,
				misaDocumentDate: "",
				misaDocumentCode: "",
			}));
			setCustomerSearch(
				`${selected?.name ?? ""}${selected?.provinceCity ? ` · ${selected.provinceCity}` : ""}`,
			);
			setCustomerPickerOpen(false);
			void loadOrders(id, form.entryDate);
			const next = await entryRepository.customerContext(id);
			if (customerRequest.current !== requestId) return;
			setContext(next);
			setForm((current) => ({
				...current,
				customer: next.customer.name,
				recipient: defaultEntryRecipient(next.recipients),
				address: next.customer.address,
			}));
			if (next.defaultCarrierId)
				void chooseCarrierFor(next, id, next.defaultCarrierId);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Không tải được thông tin khách hàng.",
			);
		}
	};
	const chooseCarrierFor = async (
		nextContext: EntryCustomerContext,
		nextCustomerId: number,
		id: number,
	) => {
		const carrier = nextContext.carriers.find((item) => item.id === id);
		if (!carrier) return;
		setCarrierId(id);
		setRate(null);
		setForm((current) => ({
			...current,
			carrier: carrier.name,
			spec: "",
			saveCarrierRate: false,
		}));
		void loadRates(nextCustomerId, id);
	};
	const chooseCarrier = async (id: number) => {
		const carrier = carrierOptions.find((item) => item.id === id);
		if (!carrier) return;
		setCarrierId(id);
		setCarrierPickerOpen(false);
		setRate(null);
		setForm((current) => ({
			...current,
			carrier: carrier.name,
			spec: "",
			saveCarrierRate: false,
		}));
		const isAssigned = context?.carriers.some((item) => item.id === id);
		if (!customerId || !isAssigned) {
			ratesRequest.current += 1;
			setRates([]);
			return;
		}
		void loadRates(customerId, id);
	};
	const changeDate = async (entryDate: string) => {
		setForm((current) => ({ ...current, entryDate }));
		onEntryDateChange?.(entryDate);
		if (customerId) {
			void loadOrders(customerId, entryDate);
		}
	};
	const save = async () => {
		const problem = validateEntry(form);
		if (problem) throw new Error(problem);
		if (form.saveCarrierRate && !form.spec.trim()) {
			throw new Error(
				"Vui lòng chọn hoặc nhập quy cách để lưu vào bảng cước nhà xe.",
			);
		}
		if (transportOverRate && !form.rateVarianceNote.trim()) {
			throw new Error("Vui lòng nhập lý do chênh lệch cước.");
		}
		await onSave(form);
	};
	const transportOverRate = Boolean(
		rate && form.transportFee > rate.transportFee,
	);
	const difference = rate ? form.transportFee - rate.transportFee : 0;

	return (
		<Dialog
			title={editingId ? "Sửa phiếu chi phí gửi hàng" : "Thêm chi phí gửi hàng"}
			subtitle="Đối chiếu khách hàng, MISA và bảng cước nhà xe"
			confirmLabel={editingId ? "Lưu thay đổi" : "Lưu phiếu"}
			onConfirm={save}
			onClose={onClose}
			className="entry-dialog"
			footerStart={
				options?.isAdmin ? (
					<label className="entry-save-rate-toggle">
						<input
							type="checkbox"
							checked={form.saveCarrierRate}
							disabled={!customerId || !carrierId}
							onChange={(event) =>
								setForm((current) => ({
									...current,
									saveCarrierRate: event.target.checked,
								}))
							}
						/>
						<span>Lưu quy cách, cước và phí cổng vào bảng cước nhà xe</span>
					</label>
				) : null
			}
		>
			{error && <Alert tone="error">{error}</Alert>}
			<FieldGrid>
				<Field label="Ngày gửi">
					{(id) => (
						<div className="entry-date-field">
							<DateInput
								id={id}
								value={form.entryDate}
								onChange={(value) => void changeDate(value)}
							/>
						</div>
					)}
				</Field>
				<Field label="Nhân viên phụ trách">
					{(id) =>
						!options ? (
							<input id={id} value="Đang tải danh sách nhân viên..." disabled />
						) : options.isAdmin ? (
							<select
								id={id}
								value={form.employeeId ?? ""}
								onChange={(event) => {
									const employeeId = Number(event.target.value) || undefined;
									if (employeeId)
										sessionStorage.setItem(
											ENTRY_EMPLOYEE_DRAFT_KEY,
											String(employeeId),
										);
									else sessionStorage.removeItem(ENTRY_EMPLOYEE_DRAFT_KEY);
									setForm((current) => ({ ...current, employeeId }));
								}}
							>
								<option value="">Chọn nhân viên phụ trách</option>
								{options.employees.map((employee) => (
									<option key={employee.id} value={employee.id}>
										{employee.name}
									</option>
								))}
							</select>
						) : (
							<input id={id} value={options?.currentUserName ?? ""} disabled />
						)
					}
				</Field>
			</FieldGrid>
			{options?.isAdmin && options.employees.length === 0 && (
				<p className="entry-employee-help" style={{ margin: "-6px 0 0" }}>
					Chưa có nhân viên đang hoạt động. Thêm nhân viên ở thẻ Nhân viên để
					Admin có thể nhập phiếu thay.
				</p>
			)}
			<Field label="Khách hàng">
				{(id) => (
					<div
						style={{
							position: "relative",
							display: "flex",
							alignItems: "center",
							border: "1px solid var(--line)",
							borderRadius: 7,
							background: "var(--panel)",
						}}
					>
						<input
							id={id}
							value={customerSearch}
							placeholder="Gõ để tìm tên khách hàng…"
							autoComplete="off"
							onFocus={() => setCustomerPickerOpen(true)}
							onBlur={() =>
								window.setTimeout(() => setCustomerPickerOpen(false), 150)
							}
							onChange={(event) => {
								const name = event.target.value;
								setCustomerSearch(name);
								setCustomerPickerOpen(true);
								if (customerId) void chooseCustomer(0, true);
							}}
						/>
						{customerPickerOpen && (
							<div
								role="listbox"
								style={{
									position: "absolute",
									zIndex: 20,
									top: "calc(100% + 4px)",
									left: 0,
									right: 0,
									maxHeight: 260,
									overflow: "auto",
									border: "1px solid var(--line)",
									borderRadius: 7,
									background: "var(--panel)",
									boxShadow: "var(--shadow-elevated)",
								}}
							>
								{matchingCustomers.length ? (
									matchingCustomers.map((customer) => (
										<button
											key={customer.id}
											type="button"
											role="option"
											style={{
												display: "flex",
												width: "100%",
												justifyContent: "space-between",
												gap: 12,
												padding: "9px 11px",
												border: 0,
												borderBottom: "1px solid var(--line-soft)",
												background: "var(--panel)",
												color: "var(--text-body)",
												font: "var(--type-body-sm) var(--sans)",
												textAlign: "left",
												cursor: "pointer",
											}}
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => void chooseCustomer(customer.id)}
										>
											<span>{customer.name}</span>
											<small
												style={{ color: "var(--muted)", whiteSpace: "nowrap" }}
											>
												{customer.provinceCity || "Chưa có tỉnh"}
											</small>
										</button>
									))
								) : (
									<p
										style={{
											margin: 0,
											padding: "10px 11px",
											color: "var(--muted)",
										}}
									>
										Không tìm thấy khách hàng phù hợp.
									</p>
								)}
							</div>
						)}
					</div>
				)}
			</Field>
			{customerId && (
				<section className="entry-misa-orders">
					<header>
						<div>
							<strong>Đơn bán hàng MISA 20 ngày gần nhất</strong>
							<span>
								{context?.customer.name} · đến {formatDate(form.entryDate)}
							</span>
						</div>
						<PackageSearch size={18} />
					</header>
					{orders.length ? (
						<div>
							{orders.map((order) => (
								<button
									key={order.documentDate}
									type="button"
									onClick={() =>
										setForm((current) => ({
											...current,
											note: order.note,
											misaDocumentDate: order.documentDate,
											misaDocumentCode: order.documentCode,
										}))
									}
								>
									<strong>
										{formatDate(order.documentDate)}
										{order.documentCode ? ` · ${order.documentCode}` : ""}
									</strong>
									<small>{order.totalQuantity} sản phẩm</small>
									<span
										style={{
											gridColumn: "1 / -1",
											whiteSpace: "normal",
											overflow: "visible",
											textOverflow: "clip",
										}}
									>
										{order.items
											.map((item) => `${item.quantity} ${item.productName}`)
											.join(" + ")}
									</span>
								</button>
							))}
						</div>
					) : (
						<p>Chưa có đơn MISA phù hợp trong 20 ngày gần nhất.</p>
					)}
				</section>
			)}
			<FieldGrid>
				<Field label="Nhà xe">
					{(id) => (
						<div className="entry-delivery-picker">
							<input
								id={id}
								value={form.carrier}
								disabled={!customerId}
								placeholder="Tìm hoặc chọn nhà xe"
								autoComplete="off"
								onFocus={() => setCarrierPickerOpen(true)}
								onBlur={() =>
									window.setTimeout(() => setCarrierPickerOpen(false), 120)
								}
								onChange={(event) => {
									const carrier = event.target.value;
									const matched = carrierOptions.find(
										(item) =>
											normalizeCustomerSearch(item.name) ===
											normalizeCustomerSearch(carrier),
									);
									setCarrierId(null);
									ratesRequest.current += 1;
									setRates([]);
									setRate(null);
									setCarrierPickerOpen(true);
									setForm((current) => ({
										...current,
										carrier,
										spec: "",
										saveCarrierRate: false,
									}));
									if (matched) void chooseCarrier(matched.id);
								}}
							/>
							{carrierPickerOpen && matchingCarriers.length ? (
								<div className="entry-delivery-options" role="listbox">
									<CarrierOptionGroup
										label="Nhà xe đã liên kết"
										options={linkedCarriers}
										onChoose={(carrierId) => void chooseCarrier(carrierId)}
									/>
									<CarrierOptionGroup
										label={
											linkedCarriers.length ? "Nhà xe khác" : "Danh sách nhà xe"
										}
										options={otherCarriers}
										onChoose={(carrierId) => void chooseCarrier(carrierId)}
									/>
								</div>
							) : null}
						</div>
					)}
				</Field>
				<Field label="Người nhận">
					{(id) => (
						<div className="entry-delivery-picker">
							<input
								id={id}
								value={form.recipient}
								placeholder="Nhập hoặc chọn người nhận"
								onFocus={() => setRecipientOptionsOpen(true)}
								onBlur={() =>
									window.setTimeout(() => setRecipientOptionsOpen(false), 120)
								}
								onChange={(event) =>
									setForm((current) => ({
										...current,
										recipient: event.target.value,
									}))
								}
							/>
							{recipientOptionsOpen && recipientOptions.length ? (
								<div className="entry-delivery-options" role="listbox">
									{recipientOptions.map((recipient) => (
										<button
											key={recipient}
											type="button"
											role="option"
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => {
												setForm((current) => ({ ...current, recipient }));
												setRecipientOptionsOpen(false);
											}}
										>
											{recipient}
										</button>
									))}
								</div>
							) : null}
						</div>
					)}
				</Field>
				<Field label="Quy cách">
					{(id) => (
						<div className="entry-delivery-picker">
							<input
								id={id}
								value={form.spec}
								disabled={!carrierId}
								placeholder="Nhập hoặc chọn quy cách"
								onFocus={() => setRateOptionsOpen(true)}
								onBlur={() =>
									window.setTimeout(() => setRateOptionsOpen(false), 120)
								}
								onChange={(event) => {
									const spec = event.target.value;
									setRate(rateForSpec(rates, spec));
									setForm((current) => ({ ...current, spec }));
								}}
							/>
							{rateOptionsOpen && carrierId && matchingRateOptions.length ? (
								<div className="entry-delivery-options" role="listbox">
									<RateOptionGroup
										label="Quy cách đã gán"
										options={assignedRateOptions}
										onChoose={(item) => {
											setRate(
												rates.find((rateItem) => rateItem.id === item.id) ??
													null,
											);
											setForm((current) => ({ ...current, spec: item.spec }));
											setRateOptionsOpen(false);
										}}
									/>
									<RateOptionGroup
										label="Thiết lập quy cách mới"
										options={newRateOptions}
										onChoose={(item) => {
											setRate(null);
											setForm((current) => ({ ...current, spec: item.spec }));
											setRateOptionsOpen(false);
										}}
									/>
								</div>
							) : null}
						</div>
					)}
				</Field>
			</FieldGrid>
			{rate && (
				<div className="entry-rate-standard">
					Cước chuẩn: <strong>{formatMoney(rate.transportFee)} đ</strong> · Phí
					cổng chuẩn: <strong>{formatMoney(rate.gateFee)} đ</strong>
				</div>
			)}
			<FieldGrid>
				<Field label="Cước vận chuyển">
					{(id) => (
						<MoneyInput
							id={id}
							value={form.transportFee}
							onValueChange={(transportFee) =>
								setForm((current) => ({ ...current, transportFee }))
							}
						/>
					)}
				</Field>
				<Field label="Phí vào cổng">
					{(id) => (
						<MoneyInput
							id={id}
							value={form.gateFee}
							onValueChange={(gateFee) =>
								setForm((current) => ({ ...current, gateFee }))
							}
						/>
					)}
				</Field>
			</FieldGrid>
			{transportOverRate && (
				<div className="entry-rate-warning">
					<AlertCircle size={17} />
					<span>
						Cước vận chuyển cao hơn giá thiết lập {formatMoney(difference)} đ.
						Vui lòng ghi rõ lý do.
					</span>
				</div>
			)}
			{transportOverRate && (
				<Field
					label="Lý do chênh lệch cước"
					hint="Hiển thị riêng trong báo cáo chênh lệch cước nhà xe."
				>
					{(id) => (
						<textarea
							id={id}
							value={form.rateVarianceNote}
							onChange={(event) =>
								setForm((current) => ({
									...current,
									rateVarianceNote: event.target.value,
								}))
							}
							placeholder="Ví dụ: Khách yêu cầu giao gấp, thay đổi địa điểm giao..."
						/>
					)}
				</Field>
			)}
			<Field label="Ghi chú">
				{(id) => (
					<textarea
						id={id}
						value={form.note}
						onChange={(event) =>
							setForm((current) => ({ ...current, note: event.target.value }))
						}
						placeholder="Chọn đơn MISA để tự điền danh sách mặt hàng"
					/>
				)}
			</Field>
		</Dialog>
	);
}
