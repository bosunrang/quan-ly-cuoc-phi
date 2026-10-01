export interface DashboardFilters {
	from: string;
	to: string;
	employeeId?: string;
}

export interface DashboardData {
	scope: "all" | "own";
	period: { from: string; to: string };
	employees: Array<{ id: number; name: string }>;
	summary: {
		entries: number;
		customers: number;
		transport: number;
		gate: number;
		other: number;
		fuel: number;
		total: number;
		varianceEntries: number;
		varianceAmount: number;
	};
	daily: Array<{
		day: string;
		transport: number;
		gate: number;
		other: number;
		fuel: number;
		total: number;
	}>;
	monthlyVariance: Array<{
		month: string;
		standardFee: number;
		actualFee: number;
		difference: number;
		entries: number;
	}>;
}
