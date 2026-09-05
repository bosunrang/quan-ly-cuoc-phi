import { api } from "../../shared/api/client";
import type { DashboardData, DashboardFilters } from "./dashboard.model";

type DashboardResponse = Omit<DashboardData, "monthlyVariance" | "summary"> & {
	monthlyVariance?: DashboardData["monthlyVariance"];
	summary: Omit<
		DashboardData["summary"],
		"varianceEntries" | "varianceAmount"
	> &
		Partial<
			Pick<DashboardData["summary"], "varianceEntries" | "varianceAmount">
		>;
};

/** Giữ giao diện tương thích khi máy chủ cũ chưa trả dữ liệu chênh lệch cước. */
export function normalizeDashboardData(data: DashboardResponse): DashboardData {
	return {
		...data,
		summary: {
			...data.summary,
			varianceEntries: data.summary.varianceEntries ?? 0,
			varianceAmount: data.summary.varianceAmount ?? 0,
		},
		monthlyVariance: data.monthlyVariance ?? [],
	};
}

export const dashboardRepository = {
	async get(filters: DashboardFilters): Promise<DashboardData> {
		const search = new URLSearchParams({ from: filters.from, to: filters.to });
		if (filters.employeeId) search.set("employeeId", filters.employeeId);
		const data = await api<DashboardResponse>(
			"GET",
			`/api/dashboard?${search}`,
		);
		return normalizeDashboardData(data);
	},
};
