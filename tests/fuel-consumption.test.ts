import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FuelData,
	fuelRepository,
} from "../src/domain/fuel/fuel.repository";
import { FuelPage } from "../src/features/fuel/FuelPage";

const data: FuelData = {
	prices: [],
	employees: [{ id: 1, name: "Nhân viên A" }],
	currentEmployee: { id: 1, name: "Nhân viên A" },
	locations: [],
	distances: [],
	records: [],
	recordsTotal: 0,
	fuelTypes: ["Xăng E10"],
	consumptionProfiles: {
		motorcycle: { consumptionLiters: 1, consumptionBaseKm: 40 },
		truck: { consumptionLiters: 7.5, consumptionBaseKm: 100 },
	},
	isAdmin: false,
};
let root: Root;
let container: HTMLDivElement;
const click = async (text: string) => {
	const button = [...container.querySelectorAll("button")].find(
		(item) =>
			item.textContent?.trim() === text ||
			item.getAttribute("aria-label") === text,
	);
	if (!button) throw new Error(`Không thấy nút ${text}`);
	await act(async () => button.click());
};
const fill = async (selector: string, value: string) => {
	const input = container.querySelector<HTMLInputElement>(selector);
	if (!input) throw new Error(`Không thấy ô ${selector}`);
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
};
beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	vi.spyOn(fuelRepository, "list").mockResolvedValue(data);
	vi.spyOn(fuelRepository, "history").mockResolvedValue({
		records: [],
		recordsTotal: 0,
	});
	vi.spyOn(fuelRepository, "saveConsumption").mockResolvedValue(
		data.consumptionProfiles,
	);
	vi.spyOn(fuelRepository, "saveRecord").mockResolvedValue({
		id: 1,
		totalFee: 10000,
	});
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("định mức nhân viên tự nhập", () => {
	it("Admin vẫn lưu được mức mặc định dùng chung", async () => {
		vi.mocked(fuelRepository.list).mockResolvedValue({
			...data,
			isAdmin: true,
			currentEmployee: null,
		});
		vi.mocked(fuelRepository.saveConsumption).mockResolvedValue({
			...data.consumptionProfiles,
			motorcycle: { consumptionLiters: 2, consumptionBaseKm: 50 },
		});
		await act(async () => root.render(createElement(FuelPage)));
		await click("Thiết lập định mức xe máy");
		await fill(".fuel-consumption-fields label:first-child input", "2");
		await fill(".fuel-consumption-fields label:last-child input", "50");
		await click("Lưu định mức");
		expect(fuelRepository.saveConsumption).toHaveBeenCalledWith({
			vehicleType: "motorcycle",
			consumptionLiters: 2,
			consumptionBaseKm: 50,
		});
		expect(container.textContent).toContain("Xe máy · 2L / 50km");
	});
	it.each(["20000", "0"])(
		"lưu đúng định mức riêng và giá xăng %s, không cập nhật cấu hình chung",
		async (price) => {
			await act(async () => root.render(createElement(FuelPage)));
			expect(
				container.querySelector('[aria-label="Thiết lập định mức ô tô"]'),
			).not.toBeNull();
			await click("Thiết lập định mức xe máy");
			await fill(
				".fuel-consumption-dialog input[autofocus], .fuel-consumption-fields label:first-child input",
				"1.5",
			);
			await fill(".fuel-consumption-fields label:last-child input", "60");
			await click("Lưu định mức");
			expect(container.textContent).toContain("Xe máy · 1.5L / 60km");
			expect(fuelRepository.saveConsumption).not.toHaveBeenCalled();
			await click("Ô tô · 7.5L / 100km");
			await click("Xe máy · 1.5L / 60km");
			expect(container.textContent).toContain("Xe máy · 1.5L / 60km");
			await fill('input[aria-label="Điểm A"]', "Kho");
			await fill('input[aria-label="Điểm B"]', "Đơn vị");
			await fill('.fuel-leg input[inputmode="decimal"]', "20");
			await fill(".fuel-price-field input", price);
			await click("Lưu tính xăng");
			expect(fuelRepository.saveRecord).toHaveBeenCalledWith(
				expect.objectContaining({
					consumptionLiters: 1.5,
					consumptionBaseKm: 60,
					fuelPrice: Number(price),
					employeeId: "1",
				}),
			);
			expect(container.textContent).toContain("Xe máy · 1.5L / 60km");
			expect(fuelRepository.saveConsumption).not.toHaveBeenCalled();
		},
	);
});
