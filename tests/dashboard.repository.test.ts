import { describe, expect, it } from "vitest";
import { normalizeDashboardData } from "../src/domain/dashboard/dashboard.repository";

describe("normalizeDashboardData", () => {
	it("bổ sung dữ liệu chênh lệch mặc định cho phản hồi từ máy chủ cũ", () => {
		const data = normalizeDashboardData({
			scope: "all",
			period: { from: "2026-09-01", to: "2026-09-03" },
			employees: [],
			summary: {
				entries: 2,
				customers: 1,
				transport: 100_000,
				gate: 10_000,
				fuel: 20_000,
				total: 130_000,
			},
			daily: [],
		});

		expect(data.summary.varianceEntries).toBe(0);
		expect(data.summary.varianceAmount).toBe(0);
		expect(data.monthlyVariance).toEqual([]);
	});
});
