import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type EntryFormOptions,
	emptyEntryInput,
} from "../src/domain/entries/entry.model";
import { entryRepository } from "../src/domain/entries/entry.repository";
import { EntryDialog } from "../src/features/entries/components/EntryDialog";
import { EntriesPage } from "../src/features/entries/EntriesPage";

const options: EntryFormOptions = {
	currentUserId: 1,
	currentUserName: "Admin",
	isAdmin: true,
	customers: [
		{ id: 1, name: "Trạm y tế A", customerCode: "A", provinceCity: "Hà Nội" },
	],
	carriers: [],
	employees: [{ id: 1, name: "Nhân viên A", userId: 1 }],
};
let root: Root;
let container: HTMLDivElement;
const button = (text: string) => {
	const found = [...container.querySelectorAll("button")].find(
		(item) => item.textContent?.trim() === text,
	);
	if (!found) throw new Error(`Không tìm thấy nút ${text}`);
	return found;
};
const labels = () =>
	[...container.querySelectorAll("label")].map((item) => item.textContent);

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	vi.spyOn(entryRepository, "list").mockResolvedValue({
		items: [],
		count: 0,
		total: 0,
		scope: "all",
	});
	vi.spyOn(entryRepository, "formOptions").mockResolvedValue(options);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("hai hình thức giao hàng", () => {
	it.each([
		{ unitFee: 40_000, direction: "thấp hơn", note: "Nhà xe giảm giá" },
		{ unitFee: 60_000, direction: "cao hơn", note: "Giao hàng gấp" },
		{ unitFee: 0, direction: "thấp hơn", note: "Nhà xe miễn cước" },
		{ unitFee: 50_000, direction: "", note: "" },
	])(
		"yêu cầu lý do khi đơn giá $unitFee chênh lệch với giá chuẩn theo số lượng",
		async ({ unitFee, direction, note }) => {
			vi.spyOn(entryRepository, "misaOrders").mockResolvedValue({ items: [] });
			vi.spyOn(entryRepository, "customerContext").mockResolvedValue({
				customer: { id: 1, name: "Trạm y tế A", recipient: "", address: "" },
				carriers: [{ id: 2, name: "Nhà xe A" }],
				recipients: [],
				defaultCarrierId: 2,
			});
			vi.spyOn(entryRepository, "rates").mockResolvedValue({
				items: [
					{
						id: 1,
						spec: "Thùng nhỏ",
						isDefault: false,
						transportFee: 50_000,
						gateFee: 0,
						note: "",
					},
				],
			});
			const save = vi.fn().mockResolvedValue(undefined);
			await act(async () =>
				root.render(
					createElement(EntryDialog, {
						editingId: 7,
						standardTransportFee: 50_000,
						formOptions: options,
						onSave: save,
						onClose: vi.fn(),
						initial: {
							...emptyEntryInput("2026-12-12"),
							customerId: 1,
							customer: "Trạm y tế A",
							employeeId: 1,
							carrierId: 2,
							carrier: "Nhà xe A",
							spec: "Thùng nhỏ",
							billStatus: "Có bill",
							note: "Hàng",
							quantity: 2,
							transportUnitFee: unitFee,
							transportFee: unitFee * 2,
						},
					}),
				),
			);
			const submit = async () =>
				act(async () =>
					container
						.querySelector("form")
						?.dispatchEvent(
							new Event("submit", { bubbles: true, cancelable: true }),
						),
				);
			if (!direction) {
				expect(labels()).not.toContain("Lý do chênh lệch cước");
				await submit();
				expect(save).toHaveBeenCalledOnce();
				return;
			}
			expect(labels()).toContain("Lý do chênh lệch cước");
			expect(container.textContent).toContain(direction);
			if (unitFee !== 0) expect(container.textContent).toContain("20.000");
			await submit();
			expect(save).not.toHaveBeenCalled();
			expect(container.textContent).toContain(
				"Vui lòng nhập lý do chênh lệch cước.",
			);
			const label = [...container.querySelectorAll("label")].find(
				(item) => item.textContent === "Lý do chênh lệch cước",
			);
			const textarea = container.querySelector<HTMLTextAreaElement>(
				`textarea[id="${label?.htmlFor}"]`,
			);
			if (!textarea) throw new Error("Không có ô lý do");
			await act(async () => {
				Object.getOwnPropertyDescriptor(
					HTMLTextAreaElement.prototype,
					"value",
				)?.set?.call(textarea, note);
				textarea.dispatchEvent(new Event("input", { bubbles: true }));
			});
			await submit();
			expect(save).toHaveBeenCalledWith(
				expect.objectContaining({
					rateVarianceNote: note,
					transportFee: unitFee * 2,
				}),
			);
		},
	);
	it("chuyển phiếu cũ sang giao trực tiếp và bỏ cước, nhà xe, Bill khi lưu", async () => {
		vi.spyOn(entryRepository, "misaOrders").mockResolvedValue({ items: [] });
		vi.spyOn(entryRepository, "customerContext").mockResolvedValue({
			customer: {
				id: 1,
				name: "Trạm y tế A",
				recipient: "",
				address: "Hà Nội",
			},
			carriers: [{ id: 2, name: "Giao hàng trực tiếp" }],
			recipients: [],
			defaultCarrierId: 2,
		});
		vi.spyOn(entryRepository, "rates").mockResolvedValue({ items: [] });
		const save = vi.fn().mockResolvedValue(undefined);
		await act(async () =>
			root.render(
				createElement(EntryDialog, {
					editingId: 7,
					formOptions: {
						...options,
						carriers: [{ id: 2, name: "Giao hàng trực tiếp" }],
					},
					onSave: save,
					onClose: vi.fn(),
					initial: {
						...emptyEntryInput("2026-12-12"),
						customerId: 1,
						customer: "Trạm y tế A",
						employeeId: 1,
						carrierId: 2,
						carrier: "Giao hàng trực tiếp",
						spec: "Thùng nhỏ",
						note: "Đơn cũ",
						billStatus: "Không bill",
						transportUnitFee: 50_000,
						transportFee: 50_000,
					},
				}),
			),
		);
		const method = container.querySelector<HTMLSelectElement>("select");
		expect(method).not.toBeNull();
		await act(async () => {
			if (!method) return;
			method.value = "direct";
			method.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(container.textContent).toContain("Sửa phiếu giao trực tiếp");
		expect(labels()).not.toContain("Nhà xe *");
		await act(async () =>
			container
				.querySelector("form")
				?.dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				),
		);
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				deliveryMethod: "direct",
				carrierId: undefined,
				spec: "Tất cả",
				carrier: "",
				transportUnitFee: 0,
				transportFee: 0,
				billStatus: "",
				note: "Đơn cũ",
			}),
		);
	});
	it("hai nút mở đúng form; giao trực tiếp khóa quy cách Tất cả và không có nhà xe, Bill hoặc cước", async () => {
		await act(async () => root.render(createElement(EntriesPage)));
		expect(container.textContent).not.toContain("Thêm chi phí");
		await act(async () => button("Gửi nhà xe").click());
		expect(labels()).toContain("Nhà xe *");
		expect(labels()).toContain("Bill *");
		expect(labels()).toContain("Số lượng");
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]')
				?.click(),
		);
		await act(async () => button("Giao trực tiếp").click());
		expect(container.textContent).toContain("Thêm phiếu giao trực tiếp");
		expect(labels()).toContain("Quy cách");
		expect(labels()).not.toContain("Số lượng");
		expect(container.textContent).not.toContain(
			"Giao trực tiếp không tính cước.",
		);
		expect(labels()).not.toContain("Nhà xe *");
		expect(labels()).not.toContain("Bill *");
		expect(labels()).not.toContain("Đơn giá vận chuyển *");
		const specLabel = [...container.querySelectorAll("label")].find(
			(item) => item.textContent === "Quy cách",
		);
		const specInput = container.querySelector<HTMLInputElement>(
			`input[id="${specLabel?.htmlFor}"]`,
		);
		expect(specInput?.disabled).toBe(true);
		expect(specInput?.value).toBe("Tất cả");
		expect(container.querySelector('input[type="number"]')).toBeNull();
		expect(
			container.querySelector('.entry-delivery-options[role="listbox"]'),
		).toBeNull();
	});

	it("lưu giao trực tiếp bỏ nhà xe và các khoản phí, không cần Bill hoặc bảng giá", async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const close = vi.fn();
		await act(async () =>
			root.render(
				createElement(EntryDialog, {
					editingId: null,
					formOptions: options,
					onSave: save,
					onClose: close,
					initial: {
						...emptyEntryInput("2026-12-12", "direct"),
						customerId: 1,
						customer: "Trạm y tế A",
						employeeId: 1,
						spec: "Thùng nhỏ",
						note: "Sản phẩm giao trực tiếp",
						quantity: 3,
					},
				}),
			),
		);
		await act(async () =>
			container
				.querySelector("form")
				?.dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				),
		);
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				deliveryMethod: "direct",
				spec: "Tất cả",
				customerId: 1,
				carrier: "",
				carrierId: undefined,
				billStatus: "",
				quantity: 3,
				transportFee: 0,
				transportUnitFee: 0,
				gateFee: 0,
				ticketFee: 0,
				otherFee: 0,
				saveCarrierRate: false,
			}),
		);
		expect(close).toHaveBeenCalledOnce();
	});
});
