import {
	ChevronLeft,
	ChevronRight,
	ClipboardList,
	Eye,
	MapPin,
	Pencil,
	Plus,
	RefreshCw,
	SlidersHorizontal,
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
import { LoadingState } from "../../shared/ui/Panel";

type Leg = { id: string; destination: string; km: string; source?: string };
type OnlineFuelPrice = {
	name: string;
	region1: number;
	region2: number;
	source: string;
};
const newLegId = () =>
	typeof globalThis.crypto?.randomUUID === "function"
		? globalThis.crypto.randomUUID()
		: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const newLeg = (): Leg => ({
	id: newLegId(),
	destination: "",
	km: "",
});
const DEFAULT_FUEL_TYPE = "Xăng E10";
const E5_FUEL_TYPE = "Xăng E5 RON 92";
const DEFAULT_REGION = "region1" as const;
const CONSUMPTION_DRAFT_KEY = "fuel-consumption-liters";
const BASE_KM_DRAFT_KEY = "fuel-consumption-base-km";
const PERIOD_FROM_DRAFT_KEY = "fuel-period-from";
const PERIOD_TO_DRAFT_KEY = "fuel-period-to";
const HISTORY_PAGE_SIZE = 10;
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
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
const LOCATION_MATCH_MIN_LENGTH = 12;
const sameLocation = (left: string, right: string) =>
	locationKey(left) === locationKey(right);
const compatibleLocation = (left: string, right: string) => {
	const leftKey = locationKey(left);
	const rightKey = locationKey(right);
	if (leftKey === rightKey) return true;
	const [shorter, longer] =
		leftKey.length < rightKey.length
			? [leftKey, rightKey]
			: [rightKey, leftKey];
	return (
		shorter.length >= LOCATION_MATCH_MIN_LENGTH && longer.includes(shorter)
	);
};
const locationType = {
	customer: "Khách hàng",
	carrier: "Nhà xe",
	employee: "Nhân viên",
} as const;

/**
 * VietMap định vị POI chính xác hơn khi có cả tên (ví dụ bệnh viện/kho) lẫn
 * địa chỉ. Không được rút gọn về mỗi địa chỉ sau khi người dùng chọn danh mục.
 */
const locationRouteText = (item: FuelData["locations"][number]) => {
	const name = item.name.trim();
	const address = item.address.trim();
	if (!name) return address;
	if (!address || locationKey(address).includes(locationKey(name)))
		return address;
	return `${name}, ${address}`;
};

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
	onChange: (value: string, allowLegacyRouteMatch?: boolean) => void;
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
		onChange(
			exact.length === 1 ? locationRouteText(exact[0]) : value,
			exact.length === 1,
		);
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
									onChange(locationRouteText(item), true);
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
		[priceEditor, setPriceEditor] = useState(false),
		[consumptionEditor, setConsumptionEditor] = useState(false),
		[editingRecord, setEditingRecord] = useState<
			FuelData["records"][number] | null
		>(null),
		[voidingRecord, setVoidingRecord] = useState<
			FuelData["records"][number] | null
		>(null),
		[deletingRecord, setDeletingRecord] = useState<
			FuelData["records"][number] | null
		>(null),
		[detailRecord, setDetailRecord] = useState<
			FuelData["records"][number] | null
		>(null);
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
		[legs, setLegs] = useState<Leg[]>([newLeg()]),
		[estimatingLegId, setEstimatingLegId] = useState<string | null>(null);
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
	useEffect(() => {
		if (!data?.isAdmin && data?.currentEmployee) {
			setEmployeeId(String(data.currentEmployee.id));
			setHistoryEmployeeId(String(data.currentEmployee.id));
		}
	}, [data?.currentEmployee, data?.isAdmin]);
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
	const setDestination = (
		index: number,
		destination: string,
		allowLegacyRouteMatch = false,
	) => {
		const from = index ? legs[index - 1].destination : origin;
		const routeLocationMatches = (left: string, right: string) =>
			sameLocation(left, right) ||
			(allowLegacyRouteMatch && compatibleLocation(left, right));
		const liveDirect = legs.find((leg, legIndex) => {
			const legFrom = legIndex ? legs[legIndex - 1].destination : origin;
			return (
				decimal(leg.km) > 0 &&
				routeLocationMatches(legFrom, from) &&
				routeLocationMatches(leg.destination, destination)
			);
		});
		const liveReverse = legs.find((leg, legIndex) => {
			const legFrom = legIndex ? legs[legIndex - 1].destination : origin;
			return (
				decimal(leg.km) > 0 &&
				routeLocationMatches(legFrom, destination) &&
				routeLocationMatches(leg.destination, from)
			);
		});
		const saved = data?.distances.find(
			(item) =>
				routeLocationMatches(item.from, from) &&
				routeLocationMatches(item.to, destination),
		);
		const reverseSaved = data?.distances.find(
			(item) =>
				routeLocationMatches(item.from, destination) &&
				routeLocationMatches(item.to, from),
		);
		const reusableDistance = liveDirect ?? liveReverse ?? saved ?? reverseSaved;
		const reusableSource = liveDirect
			? "Chặng vừa nhập trong lộ trình"
			: liveReverse
				? "Chặng ngược vừa nhập trong lộ trình"
				: saved
					? "Chặng đã lưu trong ứng dụng"
					: reverseSaved
						? "Chặng ngược đã lưu trong ứng dụng"
						: undefined;
		setLeg(index, {
			destination,
			source: reusableSource,
			...(legs[index].km || !reusableDistance
				? {}
				: { km: String(reusableDistance.km) }),
		});
	};
	const estimateAllLegs = async () => {
		const completeLegs = legs.filter((leg, index) => {
			const from = index ? legs[index - 1].destination : origin;
			return Boolean(from.trim() && leg.destination.trim());
		});
		if (!completeLegs.length) {
			setError("Vui lòng nhập điểm đi và điểm đến trước khi cập nhật km.");
			return;
		}
		setEstimatingLegId("all");
		const next = [...legs];
		let failed = false;
		let failureMessage = "";
		for (let index = 0; index < legs.length; index += 1) {
			const from = index ? legs[index - 1].destination : origin;
			const destination = legs[index].destination;
			if (!from.trim() || !destination.trim()) continue;
			try {
				const result = await fuelRepository.estimateRoute(from, destination);
				next[index] = {
					...next[index],
					km: String(result.km),
					source: result.source,
				};
			} catch (cause) {
				failed = true;
				failureMessage =
					cause instanceof Error ? cause.message : "Không lấy được km tự động.";
			}
		}
		setLegs(next);
		setEstimatingLegId(null);
		setError(
			failed ? failureMessage || "Một vài chặng chưa lấy được km." : null,
		);
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
	const resetRecordForm = () => {
		setEditingRecord(null);
		setOrigin("");
		setLegs([newLeg()]);
	};
	const editRecord = (record: FuelData["records"][number]) => {
		const recordLegs = record.legs ?? [];
		setEditingRecord(record);
		setEmployeeId(String(record.employeeId ?? ""));
		setSavedPeriodFrom(record.periodFrom);
		setSavedPeriodTo(record.periodTo);
		setFuelPrice(formatMoney(record.fuelPrice));
		setSavedConsumption(String(record.consumptionLiters));
		setSavedBaseKm(String(record.consumptionBaseKm));
		setOrigin(recordLegs[0]?.from ?? "");
		setLegs(
			recordLegs.length
				? recordLegs.map((leg) => ({
						id: newLegId(),
						destination: leg.to,
						km: String(leg.km),
					}))
				: [newLeg()],
		);
		setError(null);
	};
	const deleteRecord = async (record: FuelData["records"][number]) => {
		await fuelRepository.deleteRecord(record.id);
		await load();
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
		const input = {
			periodFrom,
			periodTo,
			employeeId,
			consumptionLiters: decimal(consumption),
			consumptionBaseKm: decimal(baseKm),
			fuelType: DEFAULT_FUEL_TYPE,
			region: DEFAULT_REGION,
			fuelPrice: appliedPrice,
			legs: routeLegs,
		};
		if (editingRecord)
			await fuelRepository.updateRecord(editingRecord.id, input);
		else await fuelRepository.saveRecord(input);
		resetRecordForm();
		await load();
	};
	if (!data)
		return error ? <Alert tone="error">{error}</Alert> : <LoadingState />;
	return (
		<>
			{error && <Alert tone="error">{error}</Alert>}
			<div className="fuel-layout">
				<section className="panel fuel-calculator fuel-workspace">
					<div className="fuel-section-head">
						<div className="fuel-section-title">
							<span className="fuel-section-icon">
								<MapPin size={18} />
							</span>
							<div>
								<strong>Lập tuyến tính xăng</strong>
								<span>Nhập theo thứ tự A → B → C.</span>
							</div>
						</div>
						<div className="fuel-calculator-tools">
							<button
								className="button secondary fuel-consumption-action"
								type="button"
								onClick={() => setConsumptionEditor(true)}
							>
								<SlidersHorizontal size={15} />
								Định mức: {consumption || "—"}L / {baseKm || "—"}km
							</button>
							{data.isAdmin && (
								<button
									className="button primary fuel-price-action"
									type="button"
									onClick={() => setPriceEditor(true)}
								>
									<RefreshCw size={15} />
									Cập nhật giá xăng
								</button>
							)}
						</div>
					</div>
					<div className="fuel-settings">
						<div className="fuel-settings-group fuel-period-settings">
							<div className="fuel-settings-group-title">
								<strong>Thông tin kỳ tính</strong>
							</div>
							<div className="fuel-period-fields">
								<label>
									Nhân viên
									<select
										value={employeeId}
										disabled={!data.isAdmin}
										onChange={(event) => setEmployeeId(event.target.value)}
									>
										{data.isAdmin && <option value="">Chọn nhân viên</option>}
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
							</div>
						</div>
					</div>
					<div className="fuel-route">
						<div className="fuel-route-head">
							<div>
								<strong>Lộ trình</strong>
								<span>
									Ghi tên địa điểm kèm địa chỉ đầy đủ để VietMap xác định đúng
									vị trí.
								</span>
							</div>
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
									<div className="fuel-leg-step" aria-hidden="true">
										<span>{index + 1}</span>
										{index < legs.length - 1 && <i />}
									</div>
									<div className="fuel-route-field">
										Điểm {String.fromCharCode(65 + index)}
										<LocationInput
											value={from}
											ariaLabel={`Điểm ${String.fromCharCode(65 + index)}`}
											readOnly={index > 0}
											placeholder={
												index
													? "Điểm đến của chặng trước"
													: "Ví dụ: Kho Naviva, 123 đường A, TP.HCM"
											}
											locations={data.locations}
											onChange={(value) => !index && setOrigin(value)}
										/>
									</div>
									<div className="fuel-route-field">
										Điểm {String.fromCharCode(66 + index)}
										<LocationInput
											value={leg.destination}
											ariaLabel={`Điểm ${String.fromCharCode(66 + index)}`}
											placeholder="Ví dụ: Bệnh viện A, số nhà, đường, tỉnh/TP"
											locations={data.locations}
											onChange={(value, allowLegacyRouteMatch) =>
												setDestination(index, value, allowLegacyRouteMatch)
											}
										/>
									</div>
									<label>
										Km
										<input
											value={leg.km}
											inputMode="decimal"
											onChange={(event) =>
												setLeg(index, {
													km: event.target.value,
													source: undefined,
												})
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
						<div className="fuel-route-actions">
							<button
								className="button secondary"
								type="button"
								onClick={() => setLegs((rows) => [...rows, newLeg()])}
							>
								<Plus size={15} />
								Thêm điểm giao
							</button>
							<button
								className={`button secondary fuel-update-distance${estimatingLegId === "all" ? " is-loading" : ""}`}
								type="button"
								disabled={estimatingLegId !== null}
								onClick={() => void estimateAllLegs()}
							>
								<RefreshCw size={15} />
								Cập nhật km (VietMap)
							</button>
						</div>
					</div>
					<div className="fuel-calculator-footer">
						<div className="fuel-footer-caption">
							<strong>Kết quả dự kiến</strong>
						</div>
						<div className="fuel-footer-metric">
							<span>Tổng quãng đường</span>
							<strong>{totalKm.toLocaleString("vi-VN")} km</strong>
						</div>
						<div className="fuel-footer-metric is-total">
							<span>Tổng tiền xăng</span>
							<strong>{formatMoney(total)} đ</strong>
						</div>
						{editingRecord && (
							<button
								className="button secondary"
								type="button"
								onClick={resetRecordForm}
							>
								Hủy sửa
							</button>
						)}
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
							{editingRecord ? "Cập nhật tính xăng" : "Lưu tính xăng"}
						</button>
					</div>
				</section>
				<section className="panel fuel-history-panel">
					<div className="fuel-section-head">
						<div className="fuel-section-title">
							<span className="fuel-section-icon history">
								<ClipboardList size={19} />
							</span>
							<div>
								<strong>Lịch sử tính tiền xăng</strong>
							</div>
						</div>
						<div className="fuel-history-filter">
							<select
								aria-label="Lọc lịch sử theo nhân viên"
								value={historyEmployeeId}
								disabled={!data.isAdmin}
								onChange={(event) => {
									setHistoryEmployeeId(event.target.value);
									setHistoryPage(1);
								}}
							>
								{data.isAdmin && <option value="">Tất cả nhân viên</option>}
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
							<div className="fuel-history-list">
								{historyRecords.map((item) => {
									return (
										<article
											key={item.id}
											className={item.status === "voided" ? "is-voided" : ""}
										>
											<div className="fuel-history-main">
												<strong>
													{item.employeeName ?? "Chưa gán nhân viên"}
												</strong>
												<span>
													{formatDate(item.periodFrom)} –{" "}
													{formatDate(item.periodTo)}
												</span>
												{item.status === "voided" && (
													<span className="fuel-history-status">
														Đã hủy: {item.voidReason}
													</span>
												)}
											</div>
											<div className="fuel-history-metric">
												<span>Quãng đường</span>
												<strong>
													{item.distanceKm.toLocaleString("vi-VN")} km
												</strong>
											</div>
											<div className="fuel-history-metric is-total">
												<span>Tổng tiền</span>
												<strong>{formatMoney(item.totalFee)} đ</strong>
											</div>
											<div className="fuel-history-actions">
												<button
													className="row-action"
													type="button"
													title="Xem chi tiết"
													aria-label="Xem chi tiết"
													onClick={() => setDetailRecord(item)}
												>
													<Eye size={15} />
												</button>
											</div>
										</article>
									);
								})}
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
						<div className="fuel-history-empty">
							<ClipboardList size={24} />
							<strong>Chưa có dữ liệu tính xăng</strong>
							<span>Chọn nhân viên khác hoặc lưu lần tính đầu tiên.</span>
						</div>
					)}
				</section>
			</div>
			{priceEditor && (
				<PriceDialog
					defaultDate={periodTo}
					defaultPrice={fuelPrice}
					prices={data.prices}
					fuelTypes={[DEFAULT_FUEL_TYPE, E5_FUEL_TYPE]}
					close={() => setPriceEditor(false)}
					saved={async (savedPrice) => {
						setPriceEditor(false);
						if (
							savedPrice.fuelType === DEFAULT_FUEL_TYPE &&
							savedPrice.region === DEFAULT_REGION
						) {
							setFuelPrice(formatMoney(savedPrice.price));
						}
						await load();
					}}
				/>
			)}
			{consumptionEditor && (
				<ConsumptionDialog
					consumption={consumption}
					baseKm={baseKm}
					close={() => setConsumptionEditor(false)}
					saved={(nextConsumption, nextBaseKm) => {
						setSavedConsumption(nextConsumption);
						setSavedBaseKm(nextBaseKm);
						setConsumptionEditor(false);
					}}
				/>
			)}
			{voidingRecord && (
				<VoidFuelRecordDialog
					record={voidingRecord}
					close={() => setVoidingRecord(null)}
					saved={async (reason) => {
						await fuelRepository.deleteRecord(voidingRecord.id, reason);
						setVoidingRecord(null);
						await load();
					}}
				/>
			)}
			{deletingRecord && (
				<DeleteFuelRecordDialog
					record={deletingRecord}
					close={() => setDeletingRecord(null)}
					saved={async () => {
						await deleteRecord(deletingRecord);
						setDeletingRecord(null);
					}}
				/>
			)}
			{detailRecord && (
				<FuelRecordDetailDialog
					record={detailRecord}
					close={() => setDetailRecord(null)}
					edit={() => {
						editRecord(detailRecord);
						setDetailRecord(null);
					}}
					remove={() => {
						setDeletingRecord(detailRecord);
						setDetailRecord(null);
					}}
					voidRecord={() => {
						setVoidingRecord(detailRecord);
						setDetailRecord(null);
					}}
				/>
			)}
		</>
	);
}

function ConsumptionDialog({
	consumption: initialConsumption,
	baseKm: initialBaseKm,
	close,
	saved,
}: {
	consumption: string;
	baseKm: string;
	close: () => void;
	saved: (consumption: string, baseKm: string) => void;
}) {
	const [consumption, setConsumption] = useState(initialConsumption);
	const [baseKm, setBaseKm] = useState(initialBaseKm);
	return (
		<Dialog
			className="fuel-consumption-dialog"
			title="Định mức nhiên liệu"
			subtitle="Thiết lập mức tiêu hao dùng để tính tiền xăng cho các chặng."
			onClose={close}
			confirmLabel="Lưu định mức"
			onConfirm={async () => {
				if (decimal(consumption) <= 0 || decimal(baseKm) <= 0)
					throw new Error("Mức tiêu hao và định mức km phải lớn hơn 0.");
				saved(consumption, baseKm);
			}}
		>
			<div className="fuel-consumption-fields">
				<label>
					Mức tiêu hao (lít)
					<input
						value={consumption}
						inputMode="decimal"
						autoFocus
						onChange={(event) => setConsumption(event.target.value)}
					/>
				</label>
				<label>
					Định mức quãng đường (km)
					<input
						value={baseKm}
						inputMode="decimal"
						onChange={(event) => setBaseKm(event.target.value)}
					/>
				</label>
			</div>
		</Dialog>
	);
}

function VoidFuelRecordDialog({
	record,
	close,
	saved,
}: {
	record: FuelData["records"][number];
	close: () => void;
	saved: (reason: string) => Promise<void>;
}) {
	const [reason, setReason] = useState("");
	return (
		<Dialog
			className="fuel-void-dialog"
			title="Hủy lần tính xăng đã chốt"
			subtitle={`Bản ghi ${formatDate(record.periodFrom)} – ${formatDate(record.periodTo)} sẽ không còn được tính vào báo cáo sau này.`}
			onClose={close}
			confirmLabel="Xác nhận hủy"
			onConfirm={async () => {
				if (!reason.trim()) throw new Error("Vui lòng nhập lý do hủy.");
				await saved(reason.trim());
			}}
		>
			<label className="field">
				Lý do hủy
				<textarea
					autoFocus
					value={reason}
					placeholder="Ví dụ: Nhân viên nhập nhầm quãng đường"
					onChange={(event) => setReason(event.target.value)}
				/>
			</label>
		</Dialog>
	);
}

function DeleteFuelRecordDialog({
	record,
	close,
	saved,
}: {
	record: FuelData["records"][number];
	close: () => void;
	saved: () => Promise<void>;
}) {
	return (
		<Dialog
			className="fuel-delete-dialog"
			title="Xóa lần tính xăng?"
			subtitle={`${record.employeeName ?? "Nhân viên"} · ${formatDate(record.periodFrom)} – ${formatDate(record.periodTo)}`}
			onClose={close}
			confirmLabel="Xóa lần tính"
			confirmClassName="danger"
			onConfirm={saved}
		>
			<p className="fuel-delete-note">
				Thao tác này không thể hoàn tác. Lần tính xăng sẽ bị xóa khỏi hệ thống.
			</p>
		</Dialog>
	);
}

function FuelRecordDetailDialog({
	record,
	close,
	edit,
	remove,
	voidRecord,
}: {
	record: FuelData["records"][number];
	close: () => void;
	edit: () => void;
	remove: () => void;
	voidRecord: () => void;
}) {
	const legs = record.legs ?? [];
	return (
		<Dialog
			className="fuel-record-detail-dialog"
			title="Chi tiết lần tính xăng"
			subtitle={`${record.employeeName ?? "Chưa gán nhân viên"} · ${formatDate(record.periodFrom)} – ${formatDate(record.periodTo)}`}
			onClose={close}
			onConfirm={async () => {}}
			footer={
				<>
					{record.canEdit && (
						<button className="button secondary" type="button" onClick={edit}>
							<Pencil size={15} /> Sửa lần tính
						</button>
					)}
					{record.canDelete && (
						<button className="button danger" type="button" onClick={remove}>
							<Trash2 size={15} /> Xóa lần tính
						</button>
					)}
					{record.canVoid && (
						<button
							className="button danger"
							type="button"
							onClick={voidRecord}
						>
							<Trash2 size={15} /> Hủy lần tính
						</button>
					)}
					<button
						className="button secondary fuel-record-detail-close"
						type="button"
						onClick={close}
					>
						Đóng
					</button>
				</>
			}
		>
			<div className="fuel-record-detail-table-wrap">
				<table className="fuel-record-detail-table">
					<thead>
						<tr>
							<th>Lộ trình</th>
							<th>Giá xăng</th>
							<th>Quãng đường</th>
							<th>Số tiền tính</th>
						</tr>
					</thead>
					<tbody>
						{legs.length ? (
							legs.map((leg, index) => {
								const legFee = Math.round(
									(leg.km * record.consumptionLiters * record.fuelPrice) /
										(record.consumptionBaseKm || 1),
								);
								return (
									<tr key={`${record.id}-${leg.from}-${leg.to}-${leg.km}`}>
										<td>
											<div className="fuel-record-route-leg">
												<span className="fuel-record-route-step">
													{index + 1}
												</span>
												<span>
													{leg.from} → {leg.to}
												</span>
											</div>
										</td>
										<td>{formatMoney(record.fuelPrice)} đ/lít</td>
										<td>{leg.km.toLocaleString("vi-VN")} km</td>
										<td>{formatMoney(legFee)} đ</td>
									</tr>
								);
							})
						) : (
							<tr>
								<td>Chưa lưu chi tiết lộ trình</td>
								<td>{formatMoney(record.fuelPrice)} đ/lít</td>
								<td>{record.distanceKm.toLocaleString("vi-VN")} km</td>
								<td>{formatMoney(record.totalFee)} đ</td>
							</tr>
						)}
					</tbody>
					{legs.length > 1 && (
						<tfoot>
							<tr>
								<th colSpan={2}>Tổng toàn bộ lộ trình</th>
								<th>{record.distanceKm.toLocaleString("vi-VN")} km</th>
								<th>{formatMoney(record.totalFee)} đ</th>
							</tr>
						</tfoot>
					)}
				</table>
			</div>
			{record.status === "voided" && (
				<p className="fuel-record-void-reason">Đã hủy: {record.voidReason}</p>
			)}
		</Dialog>
	);
}

function PriceDialog({
	defaultDate,
	defaultPrice,
	prices,
	fuelTypes,
	close,
	saved,
}: {
	defaultDate: string;
	defaultPrice: string;
	prices: FuelPrice[];
	fuelTypes: string[];
	close: () => void;
	saved: (price: FuelPrice) => Promise<void>;
}) {
	const [date, setDate] = useState(defaultDate),
		[price, setPrice] = useState(defaultPrice),
		[fuelType, setFuelType] = useState(DEFAULT_FUEL_TYPE),
		[region, setRegion] = useState<FuelPrice["region"]>(DEFAULT_REGION),
		[source, setSource] = useState("Nhập tay"),
		[online, setOnline] = useState<OnlineFuelPrice[]>([]);
	const fillStoredPrice = (
		nextDate: string,
		nextRegion: FuelPrice["region"],
		nextFuelType = fuelType,
	) => {
		const stored = prices.find(
			(item) =>
				item.fuelType === nextFuelType &&
				item.region === nextRegion &&
				item.effectiveDate <= nextDate,
		);
		setPrice(stored ? formatMoney(stored.price) : "");
		setSource(stored?.source ?? "Nhập tay");
	};
	const selectDate = (nextDate: string) => {
		setDate(nextDate);
		fillStoredPrice(nextDate, region);
	};
	const selectRegion = (nextRegion: FuelPrice["region"]) => {
		setRegion(nextRegion);
		fillStoredPrice(date, nextRegion);
	};
	const selectFuelType = (nextFuelType: string) => {
		setFuelType(nextFuelType);
		fillStoredPrice(date, region, nextFuelType);
	};
	const selectOnlinePrice = (
		item: OnlineFuelPrice,
		nextRegion: FuelPrice["region"],
	) => {
		selectFuelType(item.name.includes("E5") ? E5_FUEL_TYPE : DEFAULT_FUEL_TYPE);
		setRegion(nextRegion);
		setPrice(formatMoney(item[nextRegion]));
		setSource(item.source);
	};
	const onlineChoices = online.filter(
		(item) => item.name.includes("E10") || item.name.includes("E5"),
	);
	return (
		<Dialog
			className="fuel-price-dialog"
			title="Cập nhật giá xăng"
			subtitle="Chọn ngày và khu vực để xem hoặc cập nhật mốc giá; giá online chỉ là gợi ý."
			onClose={close}
			confirmLabel="Lưu mốc giá"
			onConfirm={async () => {
				const savedPrice = await fuelRepository.savePrice({
					effectiveDate: date,
					fuelType,
					region,
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
					Loại xăng
					<select
						value={fuelType}
						onChange={(event) => selectFuelType(event.target.value)}
					>
						{fuelTypes.map((item) => (
							<option key={item} value={item}>
								{item}
							</option>
						))}
					</select>
				</label>
				<label>
					Khu vực
					<select
						value={region}
						onChange={(event) =>
							selectRegion(event.target.value as FuelPrice["region"])
						}
					>
						<option value="region1">Vùng 1</option>
						<option value="region2">Vùng 2</option>
					</select>
				</label>
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
					setOnline(
						next.items.map((item) => ({ ...item, source: next.source })),
					);
					setSource(next.source);
					if (next.priceDate) setDate(next.priceDate);
				}}
			>
				Lấy giá online
			</button>
			{onlineChoices.length > 0 && (
				<div className="fuel-online-choices">
					{onlineChoices.map((item) => (
						<div className="fuel-online-group" key={item.name}>
							<strong>{item.name}</strong>
							<button
								className="fuel-online-choice"
								type="button"
								onClick={() => selectOnlinePrice(item, "region1")}
							>
								Vùng 1: {formatMoney(item.region1)} đ/lít
							</button>
							<button
								className="fuel-online-choice"
								type="button"
								onClick={() => selectOnlinePrice(item, "region2")}
							>
								Vùng 2: {formatMoney(item.region2)} đ/lít
							</button>
						</div>
					))}
				</div>
			)}
		</Dialog>
	);
}
