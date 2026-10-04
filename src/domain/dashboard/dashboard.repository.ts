import { api } from "../../shared/api/client";
import type { DashboardData, DashboardFilters } from "./dashboard.model";

export const dashboardRepository = {
	get(filters: DashboardFilters): Promise<DashboardData> {
		const search = new URLSearchParams({ from: filters.from, to: filters.to });
		if (filters.employeeId) search.set("employeeId", filters.employeeId);
		return api<DashboardData>("GET", `/api/dashboard?${search}`);
	},
};
