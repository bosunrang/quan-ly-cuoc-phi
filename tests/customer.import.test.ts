import { readSheet } from "read-excel-file/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCustomerWorkbook } from "../src/features/customers/customer.import";

vi.mock("read-excel-file/browser", () => ({
	readSheet: vi.fn(),
}));

const mockedReadSheet = vi.mocked(readSheet);
const file = new File([], "khach-hang.xlsx");

describe("xem trước import khách hàng theo mã", () => {
	beforeEach(() => mockedReadSheet.mockReset());

	it("đánh dấu cập nhật khi tên thay đổi nhưng mã đã tồn tại", async () => {
		mockedReadSheet.mockResolvedValue([
			["Mã khách hàng", "Tên khách hàng", "Nhà xe liên kết"],
			["ABC", "Tên khách hàng mới", "Nhà xe A"],
		] as unknown as Awaited<ReturnType<typeof readSheet>>);

		const result = await parseCustomerWorkbook(file, {
			items: [{ nameKey: "ten khach hang cu", codeKey: "ABC" }],
		});

		expect(result.updateCount).toBe(1);
		expect(result.readyCount).toBe(0);
		expect(result.rows[0]).toMatchObject({
			status: "update",
			customerCode: "ABC",
			customerName: "Tên khách hàng mới",
		});
	});

	it("không cho hai dòng trong cùng file dùng chung mã", async () => {
		mockedReadSheet.mockResolvedValue([
			["Mã khách hàng", "Tên khách hàng"],
			["ABC", "Khách hàng A"],
			["abc", "Khách hàng B"],
		] as unknown as Awaited<ReturnType<typeof readSheet>>);

		const result = await parseCustomerWorkbook(file, { items: [] });

		expect(result.readyCount).toBe(1);
		expect(result.duplicateCount).toBe(1);
		expect(result.rows[1]).toMatchObject({
			status: "duplicate",
			reason: "Mã khách hàng trùng trong file",
		});
	});
});
