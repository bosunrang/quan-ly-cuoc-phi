import { api } from "../../shared/api/client";
import type {
	CarrierVarianceReport,
	ReportData,
	ReportExport,
} from "./report.model";

export const reportRepository = {
	list: (): Promise<ReportData> => api("GET", "/api/reports"),
	carrierVariance: (
		from: string,
		to: string,
		employeeId = "",
	): Promise<CarrierVarianceReport> =>
		api(
			"GET",
			`/api/reports/carrier-variance?${new URLSearchParams({ from, to, employeeId })}`,
		),
	exportCarrierVariance: (
		from: string,
		to: string,
		employeeId = "",
	): Promise<ReportExport> =>
		api(
			"GET",
			`/api/reports/carrier-variance/export?${new URLSearchParams({ from, to, employeeId })}`,
			undefined,
			{ timeoutMs: 120_000 },
		),
	export(filters: {
		from: string;
		to: string;
		employeeId?: string;
		type: "daily" | "annual";
		extraCosts?: Array<{ name: string; amount: string; employeeId?: string }>;
	}): Promise<ReportExport> {
		const query = new URLSearchParams({
			from: filters.from,
			to: filters.to,
			type: filters.type,
		});
		if (filters.employeeId) query.set("employeeId", filters.employeeId);
		if (filters.extraCosts?.length) {
			query.set("extraCosts", JSON.stringify(filters.extraCosts));
		}
		return api("GET", `/api/reports/export?${query}`, undefined, {
			timeoutMs: 120_000,
		});
	},
};
