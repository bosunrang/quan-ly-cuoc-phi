import type { CarrierExcelExport } from "../../domain/carriers/carrier.model";
import { normalizeText } from "../../shared/lib/text";
import {
	canonicalCarrierRateSpec,
	STANDARD_CARRIER_RATE_SPECS,
} from "./carrier-rate-specs";

interface WideRateGroup {
	carrierName: string;
	customerCode: string;
	customerName: string;
	gateFee: number;
	fees: Map<string, number>;
}

/** Chuyển dữ liệu cước dạng từng dòng sang mẫu Excel mỗi quy cách một cột. */
export function wideCarrierRateExport(rates: CarrierExcelExport["rates"]) {
	const standardByKey = new Map(
		STANDARD_CARRIER_RATE_SPECS.map((spec) => [normalizeText(spec), spec]),
	);
	const customSpecs = new Map<string, string>();

	for (const rate of rates) {
		const key = normalizeText(rate.spec);
		if (key && !standardByKey.has(key) && !customSpecs.has(key)) {
			customSpecs.set(key, rate.spec.trim());
		}
	}

	const specs = [...STANDARD_CARRIER_RATE_SPECS, ...customSpecs.values()];
	const groups = new Map<string, WideRateGroup>();

	for (const rate of rates) {
		const key = JSON.stringify([
			rate.carrierName,
			rate.customerCode ?? "",
			rate.customerName,
			rate.gateFee,
		]);
		const group = groups.get(key) ?? {
			carrierName: rate.carrierName,
			customerCode: rate.customerCode ?? "",
			customerName: rate.customerName,
			gateFee: rate.gateFee,
			fees: new Map<string, number>(),
		};
		groups.set(key, group);
		const spec = canonicalCarrierRateSpec(rate.spec);
		group.fees.set(spec, rate.transportFee);
	}

	return {
		specs,
		rows: [...groups.values()].map((group) => [
			group.carrierName,
			group.customerCode,
			group.customerName,
			...specs.map((spec) => group.fees.get(spec) ?? null),
			group.gateFee,
		]),
	};
}
