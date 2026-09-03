import { api } from "../../shared/api/client";
import type {
	CarrierVarianceReport,
	ReportData,
	ReportExport,
} from "./report.model";

export const reportRepository = {
	list: (): Promise<ReportData> => api("GET", "/api/reports"),
	carrierVariance: (from: string, to: string): Promise<CarrierVarianceReport> =>
		api(
			"GET",
			`/api/reports/carrier-variance?${new URLSearchParams({ from, to })}`,
		),
	exportCarrierVariance: (from: string, to: string): Promise<ReportExport> =>
		api(
			"GET",
			`/api/reports/carrier-variance/export?${new URLSearchParams({ from, to })}`,
		),
	export(filters: {
		from: string;
		to: string;
		employeeId?: string;
		type: "daily" | "annual";
		extraCosts?: Array<{ name: string; amount: string }>;
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
		return api("GET", `/api/reports/export?${query}`);
	},
};
