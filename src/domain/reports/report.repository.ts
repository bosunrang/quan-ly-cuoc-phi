import { api } from "../../shared/api/client";
import type {
	CarrierVarianceReport,
	FuelHistoryReport,
	PrintableReport,
	ReportData,
	ReportExport,
} from "./report.model";

type EmployeeReportFilters = {
	from: string;
	to: string;
	employeeId?: string;
	type: "daily";
	extraCosts?: Array<{ name: string; amount: string; employeeId?: string }>;
};

function employeeReportQuery(filters: EmployeeReportFilters): URLSearchParams {
	const query = new URLSearchParams({
		from: filters.from,
		to: filters.to,
		type: filters.type,
	});
	if (filters.employeeId) query.set("employeeId", filters.employeeId);
	if (filters.extraCosts?.length) {
		query.set("extraCosts", JSON.stringify(filters.extraCosts));
	}
	return query;
}

function carrierVarianceQuery(from: string, to: string, employeeId: string) {
	const query = new URLSearchParams({ employeeId });
	if (from || to) {
		query.set("from", from);
		query.set("to", to);
	} else {
		// Không chọn ngày: xem toàn bộ lịch sử.
		query.set("all", "1");
	}
	return query;
}

export const reportRepository = {
	fuelHistory: (filters: {
		from: string;
		to: string;
		fuelType?: string;
		employeeId?: string;
		limit?: number;
		offset?: number;
	}): Promise<FuelHistoryReport> => {
		const query = new URLSearchParams({ from: filters.from, to: filters.to });
		if (filters.fuelType) query.set("fuelType", filters.fuelType);
		if (filters.employeeId) query.set("employeeId", filters.employeeId);
		if (filters.limit !== undefined) query.set("limit", String(filters.limit));
		if (filters.offset !== undefined)
			query.set("offset", String(filters.offset));
		return api("GET", `/api/reports/fuel-history?${query}`);
	},
	exportFuelHistory: (filters: {
		from: string;
		to: string;
		fuelType?: string;
		employeeId?: string;
	}): Promise<ReportExport> => {
		const query = new URLSearchParams({ from: filters.from, to: filters.to });
		if (filters.fuelType) query.set("fuelType", filters.fuelType);
		if (filters.employeeId) query.set("employeeId", filters.employeeId);
		return api("GET", `/api/reports/fuel-history/export?${query}`, undefined, {
			timeoutMs: 120_000,
		});
	},
	list: (): Promise<ReportData> => api("GET", "/api/reports"),
	carrierVariance: (
		from: string,
		to: string,
		employeeId = "",
		page = 1,
	): Promise<CarrierVarianceReport> => {
		const query = carrierVarianceQuery(from, to, employeeId);
		query.set("page", String(page));
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
	export(filters: EmployeeReportFilters): Promise<ReportExport> {
		const query = employeeReportQuery(filters);
		return api("GET", `/api/reports/export?${query}`, undefined, {
			timeoutMs: 120_000,
		});
	},
	print(filters: EmployeeReportFilters): Promise<PrintableReport> {
		const query = employeeReportQuery(filters);
		return api("GET", `/api/reports/print?${query}`, undefined, {
			timeoutMs: 120_000,
		});
	},
};
