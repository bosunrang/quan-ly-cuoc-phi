import { api } from "../../shared/api/client";
import type {
	CarrierVarianceReport,
	ReportData,
	ReportExport,
} from "./report.model";

function carrierVarianceQuery(from: string, to: string, employeeId: string) {
	const query = new URLSearchParams({ employeeId });
	if (from || to) {
		query.set("from", from);
		query.set("to", to);
	} else {
		// Server cũ vẫn yêu cầu ngày; server mới dùng all=1 để bỏ giới hạn ngày.
		query.set("all", "1");
		query.set("from", "1900-01-01");
		query.set("to", "9999-12-31");
	}
	return query;
}

export const reportRepository = {
	list: (): Promise<ReportData> => api("GET", "/api/reports"),
	carrierVariance: (
		from: string,
		to: string,
		employeeId = "",
	): Promise<CarrierVarianceReport> => {
		const query = carrierVarianceQuery(from, to, employeeId);
		return api("GET", `/api/reports/carrier-variance?${query}`);
	},
	exportCarrierVariance: (
		from: string,
		to: string,
		employeeId = "",
	): Promise<ReportExport> => {
		const query = carrierVarianceQuery(from, to, employeeId);
		return api(
			"GET",
			`/api/reports/carrier-variance/export?${query}`,
			undefined,
			{ timeoutMs: 120_000 },
		);
	},
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
