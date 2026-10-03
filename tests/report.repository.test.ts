import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportRepository } from "../src/domain/reports/report.repository";
import { api } from "../src/shared/api/client";

vi.mock("../src/shared/api/client", () => ({
	api: vi.fn(async () => ({})),
}));

const mockedApi = vi.mocked(api);

describe("bộ lọc xuất báo cáo", () => {
	beforeEach(() => mockedApi.mockClear());

	it("Excel và PDF gửi cùng ngày, nhân viên và chi phí khác lên máy chủ", async () => {
		const filters = {
			from: "2026-10-01",
			to: "2026-10-03",
			employeeId: "12",
			type: "daily" as const,
			extraCosts: [{ name: "Grab", amount: "45000", employeeId: "12" }],
		};
		await reportRepository.export(filters);
		await reportRepository.print(filters);

		const [excelCall, printCall] = mockedApi.mock.calls;
		expect(excelCall?.[1]).toMatch(/^\/api\/reports\/export\?/);
		expect(printCall?.[1]).toMatch(/^\/api\/reports\/print\?/);
		expect(excelCall?.[1].split("?")[1]).toBe(printCall?.[1].split("?")[1]);
		expect(new URLSearchParams(excelCall?.[1].split("?")[1])).toEqual(
			new URLSearchParams({
				from: filters.from,
				to: filters.to,
				type: filters.type,
				employeeId: filters.employeeId,
				extraCosts: JSON.stringify(filters.extraCosts),
			}),
		);
	});
});
