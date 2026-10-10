import {
	Bike,
	CarFront,
	ClipboardList,
	Eye,
	MapPin,
	Pencil,
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
import { parsePastedMoney } from "../../shared/lib/money";
import { normalizeText } from "../../shared/lib/text";
import { Alert } from "../../shared/ui/Alert";
import { DateInput } from "../../shared/ui/DateInput/DateInput";
import { Dialog } from "../../shared/ui/Dialog";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { Pagination } from "../../shared/ui/Pagination";
import { LoadingState } from "../../shared/ui/Panel";

type ExtraCost = { id: string; name: string; amount: number };
type Leg = {
	id: string;
	destination: string;
	km: string;
	source?: string;
	extraCosts: ExtraCost[];
};
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
	extraCosts: [],
});
const newExtraCost = (): ExtraCost => ({
	id: newLegId(),
	name: "",
	amount: 0,
});

const DEFAULT_FUEL_TYPE = "Xăng E10";
const E5_FUEL_TYPE = "Xăng E5 RON 92";
const DEFAULT_REGION = "region1" as const;
const VEHICLE_TYPE_DRAFT_KEY = "fuel-vehicle-type";
const PERIOD_FROM_DRAFT_KEY = "fuel-period-from";
const PERIOD_TO_DRAFT_KEY = "fuel-period-to";
const HISTORY_PAGE_SIZE = 10;
const MAX_ROUTE_LEGS = 50;
const decimal = (value: string) => Number(value.replace(",", ".")) || 0;
type VehicleType = "motorcycle" | "truck";
type ConsumptionProfile = { consumption: string; baseKm: string };
const vehicleLabels: Record<VehicleType, string> = {
	motorcycle: "Xe máy",
	truck: "Ô tô",
};
const savedVehicleLabel = (
	vehicleType: FuelData["records"][number]["vehicleType"],
) => (vehicleType ? vehicleLabels[vehicleType] : "Chưa ghi nhận");
const savedVehicleType = (): VehicleType =>
	localStorage.getItem(VEHICLE_TYPE_DRAFT_KEY) === "truck"
		? "truck"
		: "motorcycle";
const savedDateDraft = (key: string) => {
	const value = localStorage.getItem(key) ?? "";
	return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayIso();
};
const locationKey = normalizeText;
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
	if (item.type === "carrier" && item.deliveryPoint.trim())
		return item.deliveryPoint.trim();
	const name = item.name.trim();
	const address = item.address.trim();
	if (!name) return address;
	if (!address) return name;
	if (locationKey(address).includes(locationKey(name))) return address;
	return `${name}, ${address}`;
};

type LocationSearchItem = {
	item: FuelData["locations"][number];
	nameKey: string;
	searchKey: string;
};
// Danh mục địa điểm có thể lên tới vài nghìn dòng. Chuẩn hóa một lần cho mỗi
// lần tải dữ liệu và dùng chung cho mọi ô địa điểm, thay vì chuẩn hóa lại toàn
// bộ danh mục ở từng ô sau mỗi phím gõ.
const locationSearchIndexes = new WeakMap<
	FuelData["locations"],
	LocationSearchItem[]
>();
function locationSearchIndex(
	locations: FuelData["locations"],
): LocationSearchItem[] {
	let index = locationSearchIndexes.get(locations);
	if (!index) {
		index = locations.map((item) => ({
			item,
			nameKey: locationKey(item.name),
			searchKey: locationKey(
				`${item.name} ${item.address} ${item.deliveryPoint}`,
			),
		}));
		locationSearchIndexes.set(locations, index);
	}
	return index;
}

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
		if (!open || readOnly) return [];
		const query = locationKey(value);
		return locationSearchIndex(locations)
			.filter((entry) => !query || entry.searchKey.includes(query))
			.slice(0, 8)
			.map((entry) => entry.item);
	}, [locations, open, readOnly, value]);
	const type = (value: string) => {
		const key = locationKey(value);
		const exact = locationSearchIndex(locations)
			.filter((entry) => entry.nameKey === key)
			.map((entry) => entry.item);
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
									{locationType[item.type]} ·{" "}
									{item.deliveryPoint || item.address || "Chưa có địa chỉ"}
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
		[consumptionEditor, setConsumptionEditor] = useState<VehicleType | null>(
			null,
		),
		[editingRecord, setEditingRecord] = useState<
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
		[vehicleType, setVehicleType] = useState<VehicleType>(() =>
			savedVehicleType(),
		),
		[consumption, setConsumption] = useState("1"),
		[baseKm, setBaseKm] = useState("40"),
		[origin, setOrigin] = useState(""),
		[legs, setLegs] = useState<Leg[]>([newLeg()]),
		[estimatingLegId, setEstimatingLegId] = useState<string | null>(null),
		[saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const initialPeriodTo = useRef(periodTo);
	const hasLoadedInitialPrice = useRef(false);
	// Danh mục (địa điểm, giá, quãng đường) khá nặng và hiếm khi đổi: chỉ tải
	// khi mở trang hoặc sau thao tác làm đổi danh mục. Chuyển trang/lọc lịch sử
	// chỉ tải lại phần lịch sử.
	const historyParams = useMemo(
		() => ({
			limit: HISTORY_PAGE_SIZE,
			offset: (historyPage - 1) * HISTORY_PAGE_SIZE,
			employeeId: historyEmployeeId,
		}),
		[historyEmployeeId, historyPage],
	);
	const historyParamsRef = useRef(historyParams);
	historyParamsRef.current = historyParams;
	// Một bộ đếm chung: kết quả lịch sử cũ về muộn không đè kết quả mới hơn.
	const recordsRequest = useRef(0);
	const load = useCallback(async () => {
		const requestId = recordsRequest.current + 1;
		recordsRequest.current = requestId;
		try {
			const next = await fuelRepository.list(historyParamsRef.current);
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
			setData((current) =>
				recordsRequest.current === requestId || !current
					? next
					: {
							...next,
							records: current.records,
							recordsTotal: current.recordsTotal,
						},
			);
			setError(null);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không tải được dữ liệu.",
			);
		}
	}, []);
	const loadHistory = useCallback(async () => {
		const requestId = recordsRequest.current + 1;
		recordsRequest.current = requestId;
		try {
			const history = await fuelRepository.history(historyParams);
			if (recordsRequest.current !== requestId) return;
			setData((current) => (current ? { ...current, ...history } : current));
			setError(null);
		} catch (cause) {
			if (recordsRequest.current !== requestId) return;
			setError(
				cause instanceof Error ? cause.message : "Không tải được lịch sử.",
			);
		}
	}, [historyParams]);
	useEffect(() => {
		void load();
	}, [load]);
	// Lần đầu lịch sử đã đi kèm danh mục; từ đó chỉ tải lại phần lịch sử.
	const historyReady = useRef(false);
	useEffect(() => {
		if (!historyReady.current) {
			historyReady.current = true;
			return;
		}
		void loadHistory();
	}, [loadHistory]);
	useEffect(() => {
		if (!data?.isAdmin && data?.currentEmployee) {
			setEmployeeId(String(data.currentEmployee.id));
			setHistoryEmployeeId(String(data.currentEmployee.id));
		}
	}, [data?.currentEmployee, data?.isAdmin]);
	// Chỉ áp định mức khi định mức thật sự đổi (lần tải đầu, Admin sửa định mức,
	// đổi phương tiện). Mỗi lần chuyển trang lịch sử đều tải lại dữ liệu nên không
	// được ghi đè số người dùng đang nhập, và không bao giờ ghi đè định mức đã chốt
	// của bản ghi đang được sửa.
	const appliedProfileKey = useRef("");
	useEffect(() => {
		const profile = data?.consumptionProfiles[vehicleType];
		if (!profile || editingRecord) return;
		const key = `${vehicleType}:${profile.consumptionLiters}:${profile.consumptionBaseKm}`;
		if (appliedProfileKey.current === key) return;
		appliedProfileKey.current = key;
		setConsumption(String(profile.consumptionLiters));
		setBaseKm(String(profile.consumptionBaseKm));
	}, [data?.consumptionProfiles, editingRecord, vehicleType]);
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
	// `0` là giá hợp lệ khi dùng xe công ty; chỉ chuỗi rỗng mới là chưa nhập giá.
	const hasFuelPrice = fuelPrice.trim() !== "";
	const appliedPrice = Number(fuelPrice.replace(/\D/g, ""));
	const routeLegs = legs.map((leg, index) => ({
		from: index ? legs[index - 1].destination : origin,
		to: leg.destination,
		km: decimal(leg.km),
	}));
	const incompleteRouteLeg = routeLegs.find(
		(leg) => !leg.from.trim() || !leg.to.trim() || leg.km <= 0,
	);
	const totalKm = routeLegs.reduce((sum, leg) => sum + leg.km, 0);
	const fuelTotal = Math.round(
		((totalKm * decimal(consumption)) / (decimal(baseKm) || 1)) * appliedPrice,
	);
	const extraCostTotal = legs.reduce(
		(sum, leg) =>
			sum + leg.extraCosts.reduce((legSum, item) => legSum + item.amount, 0),
		0,
	);
	const total = fuelTotal + extraCostTotal;
	const historyRecords = data?.records ?? [];
	const historyPageCount = Math.max(
		1,
		Math.ceil((data?.recordsTotal ?? 0) / HISTORY_PAGE_SIZE),
	);
	const consumptionProfiles = data?.consumptionProfiles ?? {
		motorcycle: { consumptionLiters: 1, consumptionBaseKm: 40 },
		truck: { consumptionLiters: 7.5, consumptionBaseKm: 100 },
	};
	const vehicleProfileLabel = (nextVehicleType: VehicleType) => {
		const profile = consumptionProfiles[nextVehicleType];
		return profile.consumptionLiters
			? `${profile.consumptionLiters}L / ${profile.consumptionBaseKm || "—"}km`
			: "Chưa thiết lập";
	};
	const selectVehicleType = (nextVehicleType: VehicleType) => {
		if (nextVehicleType === vehicleType) return;
		const profile = consumptionProfiles[nextVehicleType];
		localStorage.setItem(VEHICLE_TYPE_DRAFT_KEY, nextVehicleType);
		setVehicleType(nextVehicleType);
		setConsumption(String(profile.consumptionLiters));
		setBaseKm(String(profile.consumptionBaseKm));
		// Khi chọn Ô tô, áp dụng giá 0 theo quy tắc xe công ty.
		if (nextVehicleType === "truck") setFuelPrice("0");
	};
	const setLeg = (index: number, patch: Partial<Leg>) =>
		setLegs((rows) =>
			rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
		);
	/** Km dùng lại được cho chặng from → destination: trong lộ trình hoặc đã lưu. */
	const reusableDistance = (
		rows: Leg[],
		routeOrigin: string,
		from: string,
		destination: string,
		allowLegacyRouteMatch = false,
		skipIndex = -1,
	) => {
		const routeLocationMatches = (left: string, right: string) =>
			sameLocation(left, right) ||
			(allowLegacyRouteMatch && compatibleLocation(left, right));
		const liveDirect = rows.find((leg, legIndex) => {
			const legFrom = legIndex ? rows[legIndex - 1].destination : routeOrigin;
			return (
				legIndex !== skipIndex &&
				decimal(leg.km) > 0 &&
				routeLocationMatches(legFrom, from) &&
				routeLocationMatches(leg.destination, destination)
			);
		});
		const liveReverse = rows.find((leg, legIndex) => {
			const legFrom = legIndex ? rows[legIndex - 1].destination : routeOrigin;
			return (
				legIndex !== skipIndex &&
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
		const found = liveDirect ?? liveReverse ?? saved ?? reverseSaved;
		const source = liveDirect
			? "Chặng vừa nhập trong lộ trình"
			: liveReverse
				? "Chặng ngược vừa nhập trong lộ trình"
				: saved
					? "Chặng đã lưu trong ứng dụng"
					: reverseSaved
						? "Chặng ngược đã lưu trong ứng dụng"
						: undefined;
		return found ? { km: String(found.km), source } : null;
	};
	/**
	 * Điểm đi của chặng `index` vừa đổi (xóa chặng trước, đổi điểm đến chặng
	 * trước hoặc đổi điểm xuất phát): km cũ thuộc về tuyến khác nên phải bỏ, rồi
	 * dùng lại km đã biết của tuyến mới nếu có; nếu không, để trống cho người
	 * dùng nhập hoặc bấm cập nhật km.
	 */
	const withRecalculatedLeg = (
		rows: Leg[],
		index: number,
		routeOrigin: string,
	) => {
		const leg = rows[index];
		if (!leg) return rows;
		const from = index ? rows[index - 1].destination : routeOrigin;
		const reused =
			from.trim() && leg.destination.trim()
				? reusableDistance(
						rows,
						routeOrigin,
						from,
						leg.destination,
						false,
						index,
					)
				: null;
		return rows.map((row, i) =>
			i === index
				? { ...row, km: reused?.km ?? "", source: reused?.source }
				: row,
		);
	};
	const setDestination = (
		index: number,
		destination: string,
		allowLegacyRouteMatch = false,
	) => {
		const from = index ? legs[index - 1].destination : origin;
		const reused = reusableDistance(
			legs,
			origin,
			from,
			destination,
			allowLegacyRouteMatch,
		);
		const startsNextLeg = !sameLocation(legs[index].destination, destination);
		setLegs((rows) => {
			const next = rows.map((row, i) =>
				i === index
					? {
							...row,
							destination,
							source: reused?.source,
							...(row.km || !reused ? {} : { km: reused.km }),
						}
					: row,
			);
			return startsNextLeg
				? withRecalculatedLeg(next, index + 1, origin)
				: next;
		});
	};
	const changeOrigin = (value: string) => {
		const startsFirstLeg = !sameLocation(origin, value);
		setOrigin(value);
		if (startsFirstLeg) setLegs((rows) => withRecalculatedLeg(rows, 0, value));
	};
	const removeLeg = (index: number) =>
		setLegs((rows) =>
			withRecalculatedLeg(
				rows.filter((_, i) => i !== index),
				index,
				origin,
			),
		);
	const estimateAllLegs = async () => {
		const routeWithMissingPlace = routeLegs.find(
			(leg) => !leg.from.trim() || !leg.to.trim(),
		);
		if (routeWithMissingPlace) {
			setError(
				"Hoàn thành điểm đi và điểm đến của mọi chặng trước khi cập nhật km.",
			);
			return;
		}
		const missingAddress = (data?.locations ?? []).find(
			(item) =>
				!item.address.trim() &&
				routeLegs.some(
					(leg) =>
						sameLocation(item.name, leg.from) ||
						sameLocation(item.name, leg.to),
				),
		);
		if (missingAddress) {
			setError(
				`${locationType[missingAddress.type]} “${missingAddress.name}” chưa có địa chỉ. Hãy bổ sung địa chỉ vào ô trước khi tính bằng VietMap.`,
			);
			return;
		}
		setEstimatingLegId("all");
		const estimated = new Map<
			string,
			{ from: string; destination: string; km: string; source: string }
		>();
		let failed = false;
		let failureMessage = "";
		for (let index = 0; index < legs.length; index += 1) {
			const from = index ? legs[index - 1].destination : origin;
			const destination = legs[index].destination;
			if (!from.trim() || !destination.trim()) continue;
			// Giữ nguyên km đã có (từ chặng đã lưu hoặc do người dùng nhập tay).
			// Nhờ đó, thêm B → C chỉ gọi VietMap cho B → C, không làm thay đổi A → B.
			if (decimal(legs[index].km) > 0) continue;
			try {
				// Người dùng vừa xóa km nên cần lấy lại kết quả trực tiếp từ VietMap,
				// không dùng quãng đường cũ mà ứng dụng đã lưu.
				const result = await fuelRepository.estimateRoute(
					from,
					destination,
					true,
				);
				estimated.set(legs[index].id, {
					from,
					destination,
					km: String(result.km),
					source: result.source,
				});
			} catch (cause) {
				failed = true;
				failureMessage =
					cause instanceof Error ? cause.message : "Không lấy được km tự động.";
			}
		}
		// Gọi VietMap có thể mất vài chục giây; người dùng vẫn sửa được lộ trình
		// trong lúc chờ. Chỉ điền km vào chặng còn đúng điểm đi/đến và chưa có km,
		// không ghi đè những gì người dùng vừa thay đổi.
		setLegs((current) =>
			current.map((leg, index) => {
				const result = estimated.get(leg.id);
				if (!result) return leg;
				const unchanged =
					leg.destination === result.destination &&
					(index === 0 || current[index - 1].destination === result.from) &&
					!(decimal(leg.km) > 0);
				return unchanged
					? { ...leg, km: result.km, source: result.source }
					: leg;
			}),
		);
		setEstimatingLegId(null);
		setError(
			failed ? failureMessage || "Một vài chặng chưa lấy được km." : null,
		);
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
		// Thoát chế độ sửa thì quay lại định mức hiện hành.
		appliedProfileKey.current = "";
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
		if (record.vehicleType) setVehicleType(record.vehicleType);
		setConsumption(String(record.consumptionLiters));
		setBaseKm(String(record.consumptionBaseKm));
		setOrigin(recordLegs[0]?.from ?? "");
		setLegs(
			recordLegs.length
				? recordLegs.map((leg, legIndex) => ({
						id: newLegId(),
						destination: leg.to,
						km: String(leg.km),
						extraCosts: record.extraCosts
							.filter((item) => (item.legIndex ?? 0) === legIndex)
							.map((item) => ({ ...item, id: newLegId() })),
					}))
				: [newLeg()],
		);
		setError(null);
	};
	const deleteRecord = async (record: FuelData["records"][number]) => {
		await fuelRepository.deleteRecord(record.id);
		await loadHistory();
	};
	const submit = async () => {
		// Khóa ngay khi bấm: bấm đúp hoặc mạng chậm không được tạo hai bản ghi.
		if (savingRef.current) return;
		savingRef.current = true;
		setSaving(true);
		try {
			await save();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không lưu được tính xăng.",
			);
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	};
	const save = async () => {
		if (!employeeId) throw new Error("Vui lòng chọn nhân viên.");
		if (!hasFuelPrice) throw new Error("Vui lòng nhập giá xăng.");
		if (!origin.trim() || !totalKm)
			throw new Error("Vui lòng nhập điểm đi và quãng đường.");
		if (incompleteRouteLeg)
			throw new Error("Mỗi chặng cần có điểm đi, điểm đến và số km lớn hơn 0.");
		const extraCosts = legs.flatMap((leg, legIndex) =>
			leg.extraCosts.map(({ name, amount }) => ({ name, amount, legIndex })),
		);
		if (extraCosts.some((item) => !item.name.trim() || item.amount <= 0))
			throw new Error("Mỗi chi phí khác cần có tên và số tiền lớn hơn 0.");
		const input = {
			periodFrom,
			periodTo,
			employeeId,
			consumptionLiters: decimal(consumption),
			consumptionBaseKm: decimal(baseKm),
			vehicleType,
			fuelType: DEFAULT_FUEL_TYPE,
			region: DEFAULT_REGION,
			fuelPrice: appliedPrice,
			legs: routeLegs,
			extraCosts,
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
							<div className="fuel-vehicle-actions">
								<div
									className={`fuel-vehicle-option ${vehicleType === "motorcycle" ? "is-active" : ""}`}
								>
									<button
										className="button secondary fuel-consumption-action"
										type="button"
										onClick={() => selectVehicleType("motorcycle")}
										aria-pressed={vehicleType === "motorcycle"}
									>
										<Bike size={17} />
										<span>Xe máy · {vehicleProfileLabel("motorcycle")}</span>
									</button>
									{data.isAdmin && (
										<button
											className="fuel-consumption-edit"
											type="button"
											onClick={() => setConsumptionEditor("motorcycle")}
											aria-label="Thiết lập định mức xe máy"
											title="Thiết lập định mức xe máy"
										>
											<Pencil size={15} />
										</button>
									)}
								</div>
								<div
									className={`fuel-vehicle-option ${vehicleType === "truck" ? "is-active" : ""}`}
								>
									<button
										className="button secondary fuel-consumption-action"
										type="button"
										onClick={() => selectVehicleType("truck")}
										aria-pressed={vehicleType === "truck"}
									>
										<CarFront size={17} />
										<span>Ô tô · {vehicleProfileLabel("truck")}</span>
									</button>
									{data.isAdmin && (
										<button
											className="fuel-consumption-edit"
											type="button"
											onClick={() => setConsumptionEditor("truck")}
											aria-label="Thiết lập định mức ô tô"
											title="Thiết lập định mức ô tô"
										>
											<Pencil size={15} />
										</button>
									)}
								</div>
							</div>
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
										placeholder="Nhập 0 nếu xe công ty"
										onChange={(event) => {
											const digits = event.target.value.replace(/\D/g, "");
											setFuelPrice(digits ? formatMoney(Number(digits)) : "");
										}}
										onPaste={(event) => {
											const pasted = parsePastedMoney(
												event.clipboardData.getData("text"),
											);
											if (pasted === null) return;
											event.preventDefault();
											setFuelPrice(formatMoney(pasted));
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
											onChange={(value) => !index && changeOrigin(value)}
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
													source: event.target.value.trim()
														? "Nhập tay"
														: undefined,
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
											onClick={() => removeLeg(index)}
										>
											<Trash2 size={16} />
										</button>
									)}
									{leg.extraCosts.length > 0 && (
										<div className="fuel-leg-extra-costs">
											{leg.extraCosts.map((item, costIndex) => (
												<div className="fuel-extra-cost" key={item.id}>
													<label>
														{costIndex === 0
															? "Tên chi phí khác"
															: "Tên chi phí"}
														<input
															value={item.name}
															placeholder="Ví dụ: Tiền ăn, gửi xe, Grab..."
															onChange={(event) =>
																setLeg(index, {
																	extraCosts: leg.extraCosts.map((current) =>
																		current.id === item.id
																			? { ...current, name: event.target.value }
																			: current,
																	),
																})
															}
														/>
													</label>
													<div className="fuel-extra-cost-field">
														<label
															htmlFor={`fuel-extra-cost-amount-${item.id}`}
														>
															Số tiền
														</label>
														<MoneyInput
															id={`fuel-extra-cost-amount-${item.id}`}
															value={item.amount}
															placeholder="Nhập số tiền (đ)"
															onValueChange={(amount) =>
																setLeg(index, {
																	extraCosts: leg.extraCosts.map((current) =>
																		current.id === item.id
																			? { ...current, amount }
																			: current,
																	),
																})
															}
														/>
													</div>
													<button
														className="row-action is-danger"
														type="button"
														aria-label="Xóa chi phí khác"
														onClick={() =>
															setLeg(index, {
																extraCosts: leg.extraCosts.filter(
																	(current) => current.id !== item.id,
																),
															})
														}
													>
														<Trash2 size={16} />
													</button>
												</div>
											))}
										</div>
									)}
								</div>
							);
						})}
						<div className="fuel-route-actions">
							<button
								className="button secondary"
								type="button"
								disabled={legs.length >= MAX_ROUTE_LEGS}
								title={
									legs.length >= MAX_ROUTE_LEGS
										? `Tối đa ${MAX_ROUTE_LEGS} chặng`
										: undefined
								}
								onClick={() => setLegs((rows) => [...rows, newLeg()])}
							>
								<Plus size={15} />
								Thêm điểm giao
							</button>
							<button
								className="button secondary"
								type="button"
								onClick={() =>
									setLegs((rows) =>
										rows.map((leg, index) =>
											index === rows.length - 1
												? {
														...leg,
														extraCosts: [...leg.extraCosts, newExtraCost()],
													}
												: leg,
										),
									)
								}
							>
								<Plus size={15} />
								Thêm chi phí khác
							</button>
							<button
								className={`button secondary fuel-update-distance${estimatingLegId === "all" ? " is-loading" : ""}`}
								type="button"
								disabled={estimatingLegId !== null}
								onClick={() => void estimateAllLegs()}
							>
								<RefreshCw size={15} />
								Cập nhật km còn thiếu (VietMap)
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
							<span>{extraCostTotal ? "Tiền xăng" : "Tổng tiền xăng"}</span>
							<strong>{formatMoney(fuelTotal)} đ</strong>
						</div>
						{extraCostTotal > 0 && (
							<>
								<div className="fuel-footer-metric">
									<span>Chi phí khác</span>
									<strong>{formatMoney(extraCostTotal)} đ</strong>
								</div>
								<div className="fuel-footer-metric is-total">
									<span>Tổng chi phí</span>
									<strong>{formatMoney(total)} đ</strong>
								</div>
							</>
						)}
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
							disabled={
								saving ||
								!hasFuelPrice ||
								!totalKm ||
								Boolean(incompleteRouteLeg)
							}
							onClick={() => void submit()}
						>
							{saving
								? "Đang lưu…"
								: editingRecord
									? "Cập nhật tính xăng"
									: "Lưu tính xăng"}
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
											<div className="fuel-history-metrics">
												<div className="fuel-history-metric">
													<span>Quãng đường</span>
													<strong>
														{item.distanceKm.toLocaleString("vi-VN")} km
													</strong>
												</div>
												<div className="fuel-history-metric">
													<span>Giá xăng</span>
													<strong>{formatMoney(item.fuelPrice)} đ/lít</strong>
												</div>
												<div className="fuel-history-metric is-total">
													<span>Tổng tiền</span>
													<strong>{formatMoney(item.totalFee)} đ</strong>
												</div>
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
							<Pagination
								label="Phân trang lịch sử tính xăng"
								page={historyPage}
								pageCount={historyPageCount}
								onPageChange={setHistoryPage}
							/>
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
					vehicleType={consumptionEditor}
					profile={{
						consumption: String(
							consumptionProfiles[consumptionEditor].consumptionLiters,
						),
						baseKm: String(
							consumptionProfiles[consumptionEditor].consumptionBaseKm,
						),
					}}
					close={() => setConsumptionEditor(null)}
					saved={async (nextConsumption, nextBaseKm) => {
						const profiles = await fuelRepository.saveConsumption({
							vehicleType: consumptionEditor,
							consumptionLiters: decimal(nextConsumption),
							consumptionBaseKm: decimal(nextBaseKm),
						});
						setData((current) =>
							current ? { ...current, consumptionProfiles: profiles } : current,
						);
						localStorage.setItem(VEHICLE_TYPE_DRAFT_KEY, consumptionEditor);
						setVehicleType(consumptionEditor);
						setConsumption(nextConsumption);
						setBaseKm(nextBaseKm);
						setConsumptionEditor(null);
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
				/>
			)}
		</>
	);
}

function ConsumptionDialog({
	vehicleType,
	profile,
	close,
	saved,
}: {
	vehicleType: VehicleType;
	profile: ConsumptionProfile;
	close: () => void;
	saved: (consumption: string, baseKm: string) => Promise<void>;
}) {
	const [consumption, setConsumption] = useState(profile.consumption);
	const [baseKm, setBaseKm] = useState(profile.baseKm);
	return (
		<Dialog
			className="fuel-consumption-dialog"
			title={`Định mức ${vehicleLabels[vehicleType]}`}
			subtitle="Thiết lập mức tiêu hao riêng cho loại xe này."
			onClose={close}
			confirmLabel="Lưu định mức"
			onConfirm={async () => {
				if (decimal(consumption) <= 0 || decimal(baseKm) <= 0)
					throw new Error("Mức tiêu hao và định mức km phải lớn hơn 0.");
				await saved(consumption, baseKm);
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
}: {
	record: FuelData["records"][number];
	close: () => void;
	edit: () => void;
	remove: () => void;
}) {
	const legs = record.legs ?? [];
	const extraCostsForLeg = (legIndex: number) =>
		record.extraCosts.filter((item) => (item.legIndex ?? 0) === legIndex);
	const extraCostTotal = record.extraCosts.reduce(
		(sum, item) => sum + item.amount,
		0,
	);
	const fuelTotal = record.totalFee - extraCostTotal;
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
							<th>Phương tiện</th>
							<th>Giá xăng</th>
							<th>Quãng đường</th>
							<th>Tiền xăng</th>
							<th>Chi phí khác</th>
						</tr>
					</thead>
					<tbody>
						{legs.length ? (
							legs.map((leg, index) => {
								const legFee = Math.round(
									(leg.km * record.consumptionLiters * record.fuelPrice) /
										(record.consumptionBaseKm || 1),
								);
								const extraCosts = extraCostsForLeg(index);
								const legExtraCost = extraCosts.reduce(
									(sum, item) => sum + item.amount,
									0,
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
										<td>{savedVehicleLabel(record.vehicleType)}</td>
										<td>{formatMoney(record.fuelPrice)} đ/lít</td>
										<td>{leg.km.toLocaleString("vi-VN")} km</td>
										<td>{formatMoney(legFee)} đ</td>
										<td>
											{legExtraCost ? (
												<div className="fuel-record-extra-cost">
													<span>
														{extraCosts.map((item) => item.name).join(" / ")}
													</span>
													<strong>{formatMoney(legExtraCost)} đ</strong>
												</div>
											) : (
												"—"
											)}
										</td>
									</tr>
								);
							})
						) : (
							<tr>
								<td>Chưa lưu chi tiết lộ trình</td>
								<td>{savedVehicleLabel(record.vehicleType)}</td>
								<td>{formatMoney(record.fuelPrice)} đ/lít</td>
								<td>{record.distanceKm.toLocaleString("vi-VN")} km</td>
								<td>{formatMoney(fuelTotal)} đ</td>
								<td>
									{extraCostTotal ? `${formatMoney(extraCostTotal)} đ` : "—"}
								</td>
							</tr>
						)}
					</tbody>
					{legs.length > 1 && (
						<tfoot>
							<tr>
								<th colSpan={3}>Tổng toàn bộ lộ trình</th>
								<th>{record.distanceKm.toLocaleString("vi-VN")} km</th>
								<th>{formatMoney(fuelTotal)} đ</th>
								<th>
									{extraCostTotal ? `${formatMoney(extraCostTotal)} đ` : "—"}
								</th>
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
		[online, setOnline] = useState<OnlineFuelPrice[]>([]),
		[onlineError, setOnlineError] = useState<string | null>(null),
		[onlineLoading, setOnlineLoading] = useState(false);
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
						onPaste={(event) => {
							const pasted = parsePastedMoney(
								event.clipboardData.getData("text"),
							);
							if (pasted === null) return;
							event.preventDefault();
							setPrice(formatMoney(pasted));
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
				disabled={onlineLoading}
				onClick={async () => {
					setOnlineError(null);
					setOnlineLoading(true);
					try {
						const next = await fuelRepository.online();
						setOnline(
							next.items.map((item) => ({ ...item, source: next.source })),
						);
						setSource(next.source);
						if (next.priceDate) setDate(next.priceDate);
					} catch (cause) {
						setOnlineError(
							cause instanceof Error
								? cause.message
								: "Không lấy được giá xăng online.",
						);
					} finally {
						setOnlineLoading(false);
					}
				}}
			>
				{onlineLoading ? "Đang lấy giá…" : "Lấy giá online"}
			</button>
			{onlineError && <Alert tone="error">{onlineError}</Alert>}
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
