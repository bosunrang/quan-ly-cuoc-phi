import {
	ChevronLeft,
	ChevronRight,
	Fuel,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type FuelData,
	type FuelPrice,
	fuelRepository,
} from "../../domain/fuel/fuel.repository";
import { formatDate, formatMoney, todayIso } from "../../shared/lib/format";
import { Alert } from "../../shared/ui/Alert";
import { DateInput } from "../../shared/ui/DateInput/DateInput";
import { Dialog } from "../../shared/ui/Dialog";
import { EmptyState, LoadingState } from "../../shared/ui/Panel";

type Leg = { id: string; destination: string; km: string };
const newLeg = (): Leg => ({
	id: crypto.randomUUID(),
	destination: "",
	km: "",
});
const DEFAULT_FUEL_TYPE = "Xăng E10";
const DEFAULT_REGION = "region1" as const;
const CONSUMPTION_DRAFT_KEY = "fuel-consumption-liters";
const BASE_KM_DRAFT_KEY = "fuel-consumption-base-km";
const PERIOD_FROM_DRAFT_KEY = "fuel-period-from";
const PERIOD_TO_DRAFT_KEY = "fuel-period-to";
const HISTORY_PAGE_SIZE = 50;
const decimal = (value: string) => Number(value.replace(",", ".")) || 0;
const savedDraft = (key: string, fallback: string) => {
	const value = localStorage.getItem(key);
	return value?.trim() ? value : fallback;
};
const savedDateDraft = (key: string) => {
	const value = localStorage.getItem(key) ?? "";
	return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayIso();
};
const locationKey = (value: string) =>
	value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[đĐ]/g, "d")
		.toLocaleLowerCase("vi-VN")
		.trim();
const locationType = {
	customer: "Khách hàng",
	carrier: "Nhà xe",
	employee: "Nhân viên",
} as const;

function LocationInput({
	value,
	ariaLabel,
	placeholder,
	locations,
	readOnly = false,
	onChange,
}: {
	value: string;
	ariaLabel: string;
	placeholder: string;
	locations: FuelData["locations"];
	readOnly?: boolean;
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const matches = useMemo(() => {
		const query = locationKey(value);
		return locations
			.filter(
				(item) =>
					!query ||
					locationKey(item.name).includes(query) ||
					locationKey(item.address).includes(query),
			)
			.slice(0, 8);
	}, [locations, value]);
	const type = (value: string) => {
		const exact = locations.filter(
			(item) => locationKey(item.name) === locationKey(value),
		);
		onChange(exact.length === 1 ? exact[0].address : value);
	};
	return (
		<div className="fuel-location-picker">
			<input
				value={value}
				aria-label={ariaLabel}
				readOnly={readOnly}
				placeholder={placeholder}
				autoComplete="off"
				onFocus={() => !readOnly && setOpen(true)}
				onBlur={() => window.setTimeout(() => setOpen(false), 150)}
				onChange={(event) => {
					setOpen(true);
					type(event.target.value);
				}}
			/>
			{open && !readOnly && (
				<div className="fuel-location-menu" role="listbox">
					{matches.length ? (
						matches.map((item) => (
							<button
								type="button"
								role="option"
								key={`${item.type}-${item.id}`}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => {
									onChange(item.address);
									setOpen(false);
								}}
							>
								<strong>{item.name}</strong>
								<span>
									{locationType[item.type]} · {item.address}
								</span>
							</button>
						))
					) : (
						<p>Không tìm thấy địa điểm phù hợp.</p>
					)}
				</div>
			)}
		</div>
	);
}

export function FuelPage() {
	const [data, setData] = useState<FuelData | null>(null),
		[error, setError] = useState<string | null>(null),
		[priceEditor, setPriceEditor] = useState(false);
	const [employeeId, setEmployeeId] = useState(""),
		[historyEmployeeId, setHistoryEmployeeId] = useState(""),
		[historyPage, setHistoryPage] = useState(1),
		[periodFrom, setPeriodFrom] = useState(() =>
			savedDateDraft(PERIOD_FROM_DRAFT_KEY),
		),
		[periodTo, setPeriodTo] = useState(() =>
			savedDateDraft(PERIOD_TO_DRAFT_KEY),
		),
		[fuelPrice, setFuelPrice] = useState(""),
		[consumption, setConsumption] = useState(() =>
			savedDraft(CONSUMPTION_DRAFT_KEY, "3.5"),
		),
		[baseKm, setBaseKm] = useState(() => savedDraft(BASE_KM_DRAFT_KEY, "40")),
		[origin, setOrigin] = useState(""),
		[legs, setLegs] = useState<Leg[]>([newLeg()]);
	const initialPeriodTo = useRef(periodTo);
	const hasLoadedInitialPrice = useRef(false);
	const load = useCallback(async () => {
		try {
			const next = await fuelRepository.list({
				limit: HISTORY_PAGE_SIZE,
				offset: (historyPage - 1) * HISTORY_PAGE_SIZE,
				employeeId: historyEmployeeId,
			});
			if (!hasLoadedInitialPrice.current) {
				const initialPrice = next.prices.find(
					(item) =>
						item.fuelType === DEFAULT_FUEL_TYPE &&
						item.region === DEFAULT_REGION &&
						item.effectiveDate <= initialPeriodTo.current,
				);
				setFuelPrice(initialPrice ? formatMoney(initialPrice.price) : "");
				hasLoadedInitialPrice.current = true;
			}
			setData(next);
			setError(null);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không tải được dữ liệu.",
			);
		}
	}, [historyEmployeeId, historyPage]);
	useEffect(() => {
		void load();
	}, [load]);
	const findStoredPrice = (date: string) =>
		data?.prices.find(
			(item) =>
				item.fuelType === DEFAULT_FUEL_TYPE &&
				item.region === DEFAULT_REGION &&
				item.effectiveDate <= date,
		);
	const fillStoredPrice = (date: string) => {
		const stored = findStoredPrice(date);
		setFuelPrice(stored ? formatMoney(stored.price) : "");
	};
	const appliedPrice = Number(fuelPrice.replace(/\D/g, ""));
	const totalKm = legs.reduce((sum, leg) => sum + decimal(leg.km), 0);
	const total = Math.round(
		((totalKm * decimal(consumption)) / (decimal(baseKm) || 1)) * appliedPrice,
	);
	const historyRecords = data?.records ?? [];
	const historyPageCount = Math.max(
		1,
		Math.ceil((data?.recordsTotal ?? 0) / HISTORY_PAGE_SIZE),
	);
	const setLeg = (index: number, patch: Partial<Leg>) =>
		setLegs((rows) =>
			rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
		);
	const setDestination = (index: number, destination: string) => {
		const from = index ? legs[index - 1].destination : origin;
		const saved = data?.distances.find(
			(item) =>
				locationKey(item.from) === locationKey(from) &&
				locationKey(item.to) === locationKey(destination),
		);
		setLeg(index, {
			destination,
			...(legs[index].km || !saved ? {} : { km: String(saved.km) }),
		});
	};
	const setSavedConsumption = (value: string) => {
		setConsumption(value);
		localStorage.setItem(CONSUMPTION_DRAFT_KEY, value);
	};
	const setSavedBaseKm = (value: string) => {
		setBaseKm(value);
		localStorage.setItem(BASE_KM_DRAFT_KEY, value);
	};
	const setSavedPeriodFrom = (value: string) => {
		setPeriodFrom(value);
		localStorage.setItem(PERIOD_FROM_DRAFT_KEY, value);
	};
	const setSavedPeriodTo = (value: string) => {
		setPeriodTo(value);
		localStorage.setItem(PERIOD_TO_DRAFT_KEY, value);
		fillStoredPrice(value);
	};
	const save = async () => {
		if (!employeeId) throw new Error("Vui lòng chọn nhân viên.");
		if (!origin.trim() || !totalKm)
			throw new Error("Vui lòng nhập điểm đi và quãng đường.");
		const routeLegs = legs
			.map((leg, index) => ({
				from: index ? legs[index - 1].destination : origin,
				to: leg.destination,
				km: decimal(leg.km),
			}))
			.filter((leg) => leg.from.trim() && leg.to.trim() && leg.km > 0);
		if (!routeLegs.length)
			throw new Error("Mỗi chặng cần có điểm đến và số km.");
		await fuelRepository.saveRecord({
			periodFrom,
			periodTo,
			employeeId,
			consumptionLiters: decimal(consumption),
			consumptionBaseKm: decimal(baseKm),
			fuelType: DEFAULT_FUEL_TYPE,
			region: DEFAULT_REGION,
			fuelPrice: appliedPrice,
			legs: routeLegs,
		});
		setOrigin("");
		setLegs([newLeg()]);
		await load();
	};
	if (!data)
		return error ? <Alert tone="error">{error}</Alert> : <LoadingState />;
	return (
		<>
			<section className="panel fuel-intro">
				<div className="fuel-intro-icon">
					<Fuel size={22} />
				</div>
				<div>
					<h2>Tính giá xăng</h2>
					<p>
						Tính theo từng chặng di chuyển và lưu vào kỳ tính xăng của nhân
						viên.
					</p>
				</div>
				{data.isAdmin && (
					<button
						className="button secondary"
						type="button"
						onClick={() => setPriceEditor(true)}
					>
						<RefreshCw size={16} />
						Cập nhật giá xăng
					</button>
				)}
			</section>
			{error && <Alert tone="error">{error}</Alert>}
			<div className="fuel-layout">
				<section className="panel fuel-calculator fuel-workspace">
					<div className="fuel-section-head">
						<div>
							<strong>Lập tuyến tính xăng</strong>
							<span>
								Nhập theo thứ tự A → B → C. Chặng cũ sẽ gợi lại km đã lưu.
							</span>
						</div>
					</div>
					<div className="fuel-settings">
						<label>
							Nhân viên
							<select
								value={employeeId}
								onChange={(event) => setEmployeeId(event.target.value)}
							>
								<option value="">Chọn nhân viên</option>
								{data.employees.map((employee) => (
									<option key={employee.id} value={employee.id}>
										{employee.name}
									</option>
								))}
							</select>
						</label>
						<div className="fuel-date-field">
							Từ ngày
							<DateInput
								value={periodFrom}
								ariaLabel="Từ ngày"
								onChange={setSavedPeriodFrom}
							/>
						</div>
						<div className="fuel-date-field">
							Đến ngày
							<DateInput
								value={periodTo}
								ariaLabel="Đến ngày"
								onChange={setSavedPeriodTo}
							/>
						</div>
						<label className="fuel-price-field">
							Giá xăng (đ/lít)
							<input
								value={fuelPrice}
								inputMode="numeric"
								placeholder="Chưa có giá"
								onChange={(event) => {
									const digits = event.target.value.replace(/\D/g, "");
									setFuelPrice(digits ? formatMoney(Number(digits)) : "");
								}}
							/>
						</label>
						<div className="fuel-default-settings">
							<label className="fuel-compact-field">
								<span className="fuel-field-title">
									Mức tiêu hao
									<small>lít / {baseKm || 0} km</small>
								</span>
								<input
									value={consumption}
									inputMode="decimal"
									onChange={(event) => setSavedConsumption(event.target.value)}
								/>
							</label>
							<label className="fuel-compact-field">
								Định mức km
								<input
									value={baseKm}
									inputMode="decimal"
									onChange={(event) => setSavedBaseKm(event.target.value)}
								/>
							</label>
						</div>
					</div>
					<div className="fuel-route">
						<div className="fuel-route-head">
							<strong>Lộ trình</strong>
							<span>Điểm đến của chặng trước là điểm đi của chặng sau.</span>
						</div>
						{legs.map((leg, index) => {
							const from = index ? legs[index - 1].destination : origin;
							const fee = Math.round(
								((decimal(leg.km) * decimal(consumption)) /
									(decimal(baseKm) || 1)) *
									appliedPrice,
							);
							return (
								<div
									className={`fuel-leg${legs.length > 1 ? " fuel-leg-removable" : ""}`}
									key={leg.id}
								>
									<div className="fuel-route-field">
										Điểm {String.fromCharCode(65 + index)}
										<LocationInput
											value={from}
											ariaLabel={`Điểm ${String.fromCharCode(65 + index)}`}
											readOnly={index > 0}
											placeholder="Ví dụ: Công ty Naviva"
											locations={data.locations}
											onChange={(value) => !index && setOrigin(value)}
										/>
									</div>
									<div className="fuel-route-field">
										Điểm {String.fromCharCode(66 + index)}
										<LocationInput
											value={leg.destination}
											ariaLabel={`Điểm ${String.fromCharCode(66 + index)}`}
											placeholder="Điểm giao hoặc địa chỉ"
											locations={data.locations}
											onChange={(value) => setDestination(index, value)}
										/>
									</div>
									<label>
										Quãng đường (km)
										<input
											value={leg.km}
											inputMode="decimal"
											onChange={(event) =>
												setLeg(index, { km: event.target.value })
											}
										/>
									</label>
									<div className="fuel-leg-fee-field">
										<span>Tiền xăng</span>
										<div className="fuel-leg-fee">
											<strong>{formatMoney(fee)} đ</strong>
										</div>
									</div>
									{legs.length > 1 && (
										<button
											className="row-action is-danger fuel-delete-leg"
											type="button"
											aria-label="Xóa chặng"
											onClick={() =>
												setLegs((rows) => rows.filter((_, i) => i !== index))
											}
										>
											<Trash2 size={16} />
										</button>
									)}
								</div>
							);
						})}
						<button
							className="button secondary"
							type="button"
							onClick={() => setLegs((rows) => [...rows, newLeg()])}
						>
							<Plus size={15} />
							Thêm điểm giao
						</button>
					</div>
					<div className="fuel-calculator-footer">
						<div>
							<span>Tổng quãng đường</span>
							<strong>{totalKm.toLocaleString("vi-VN")} km</strong>
						</div>
						<div>
							<span>Tổng tiền xăng</span>
							<strong>{formatMoney(total)} đ</strong>
						</div>
						<button
							className="button primary"
							type="button"
							disabled={!appliedPrice || !totalKm}
							onClick={() =>
								void save().catch((cause) =>
									setError(
										cause instanceof Error
											? cause.message
											: "Không lưu được tính xăng.",
									),
								)
							}
						>
							Lưu tính xăng
						</button>
					</div>
				</section>
				<section className="panel fuel-history-panel">
					<div className="fuel-section-head">
						<div>
							<strong>Lịch sử tính tiền xăng</strong>
							<span>
								Lưu theo nhân viên và khoảng ngày để dùng trong báo cáo.
							</span>
						</div>
						<div className="fuel-history-filter">
							<select
								aria-label="Lọc lịch sử theo nhân viên"
								value={historyEmployeeId}
								onChange={(event) => {
									setHistoryEmployeeId(event.target.value);
									setHistoryPage(1);
								}}
							>
								<option value="">Tất cả nhân viên</option>
								{data.employees.map((employee) => (
									<option value={employee.id} key={employee.id}>
										{employee.name}
									</option>
								))}
							</select>
						</div>
					</div>
					{historyRecords.length ? (
						<>
							<div className="table-scroll">
								<table className="fuel-table">
									<thead>
										<tr>
											<th>Nhân viên</th>
											<th>Khoảng ngày</th>
											<th>Quãng đường</th>
											<th>Tổng tiền</th>
										</tr>
									</thead>
									<tbody>
										{historyRecords.map((item) => (
											<tr key={item.id}>
												<td>{item.employeeName ?? "—"}</td>
												<td>
													{formatDate(item.periodFrom)} –{" "}
													{formatDate(item.periodTo)}
												</td>
												<td>{item.distanceKm.toLocaleString("vi-VN")} km</td>
												<td className="fuel-money">
													{formatMoney(item.totalFee)} đ
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							{historyPageCount > 1 && (
								<footer className="fuel-history-pagination">
									<button
										type="button"
										className="button secondary"
										title="Trang trước"
										aria-label="Trang trước"
										disabled={historyPage === 1}
										onClick={() => setHistoryPage((page) => page - 1)}
									>
										<ChevronLeft size={16} />
									</button>
									<span>
										Trang {historyPage} / {historyPageCount}
									</span>
									<button
										type="button"
										className="button secondary"
										title="Trang sau"
										aria-label="Trang sau"
										disabled={historyPage === historyPageCount}
										onClick={() => setHistoryPage((page) => page + 1)}
									>
										<ChevronRight size={16} />
									</button>
								</footer>
							)}
						</>
					) : (
						<EmptyState>
							Chưa có lần tính xăng cho nhân viên đã chọn.
						</EmptyState>
					)}
				</section>
			</div>
			{priceEditor && (
				<PriceDialog
					defaultDate={periodTo}
					defaultPrice={fuelPrice}
					prices={data.prices}
					close={() => setPriceEditor(false)}
					saved={async (savedPrice) => {
						setPriceEditor(false);
						setFuelPrice(formatMoney(savedPrice.price));
						await load();
					}}
				/>
			)}
		</>
	);
}
function PriceDialog({
	defaultDate,
	defaultPrice,
	prices,
	close,
	saved,
}: {
	defaultDate: string;
	defaultPrice: string;
	prices: FuelPrice[];
	close: () => void;
	saved: (price: FuelPrice) => Promise<void>;
}) {
	const [date, setDate] = useState(defaultDate),
		[price, setPrice] = useState(defaultPrice),
		[source, setSource] = useState("Nhập tay"),
		[online, setOnline] = useState<
			Array<{ name: string; region1: number; region2: number }>
		>([]);
	const selectDate = (nextDate: string) => {
		setDate(nextDate);
		const stored = prices.find(
			(item) =>
				item.fuelType === DEFAULT_FUEL_TYPE &&
				item.region === DEFAULT_REGION &&
				item.effectiveDate <= nextDate,
		);
		setPrice(stored ? formatMoney(stored.price) : "");
		setSource(stored?.source ?? "Nhập tay");
	};
	return (
		<Dialog
			className="fuel-price-dialog"
			title="Cập nhật giá xăng"
			subtitle="Chọn ngày để xem hoặc cập nhật mốc giá; giá online chỉ là gợi ý."
			onClose={close}
			confirmLabel="Lưu mốc giá"
			onConfirm={async () => {
				const savedPrice = await fuelRepository.savePrice({
					effectiveDate: date,
					fuelType: DEFAULT_FUEL_TYPE,
					region: DEFAULT_REGION,
					price: Number(price.replace(/\D/g, "")),
					source,
				});
				await saved(savedPrice);
			}}
		>
			<div className="fuel-price-fields">
				<div className="fuel-date-field">
					Ngày hiệu lực
					<DateInput
						value={date}
						ariaLabel="Ngày hiệu lực"
						onChange={selectDate}
					/>
				</div>
				<label>
					Giá
					<input
						value={price}
						inputMode="numeric"
						onChange={(event) => {
							const digits = event.target.value.replace(/\D/g, "");
							setPrice(digits ? formatMoney(Number(digits)) : "");
						}}
					/>
				</label>
				<label>
					Nguồn
					<input
						value={source}
						onChange={(event) => setSource(event.target.value)}
					/>
				</label>
			</div>
			<button
				className="button secondary"
				type="button"
				onClick={async () => {
					const next = await fuelRepository.online();
					setOnline(next.items);
					setSource(next.source);
					if (next.priceDate) setDate(next.priceDate);
				}}
			>
				Lấy giá online
			</button>
			{online
				.filter((item) => item.name.includes("E10"))
				.map((item) => (
					<button
						className="fuel-online-choice"
						type="button"
						key={item.name}
						onClick={() => setPrice(formatMoney(item.region1))}
					>
						{item.name}: {formatMoney(item.region1)} đ/lít
					</button>
				))}
		</Dialog>
	);
}
