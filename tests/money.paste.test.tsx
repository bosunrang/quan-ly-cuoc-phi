import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePastedMoney } from "../src/shared/lib/money";
import { DateInput } from "../src/shared/ui/DateInput/DateInput";
import { Dialog } from "../src/shared/ui/Dialog";
import { MoneyInput } from "../src/shared/ui/MoneyInput";

describe("dán số tiền có phần thập phân", () => {
	it.each([
		["1,234.00", 1234],
		["1.234,50 đ", 1235],
		["385.000,00", 385000],
		["2,500,000.75 VND", 2500001],
		["0,00", 0],
	])("%s là %i đồng", (text, expected) => {
		expect(parsePastedMoney(text)).toBe(expected);
	});

	it.each(["385.000", "385,000", "1.234.567 đ", "120000", "abc", "", "1.23.4,5x"])(
		"%s không có phần thập phân: để ô nhập xử lý như gõ tay",
		(text) => {
			expect(parsePastedMoney(text)).toBeNull();
		},
	);

	it("ô tiền nhận 1.234 đồng khi dán 1,234.00 từ Excel", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const onValueChange = vi.fn();
		const root = createRoot(container);
		act(() => root.render(<MoneyInput value={0} onValueChange={onValueChange} />));
		const input = container.querySelector("input") as HTMLInputElement;
		const paste = new Event("paste", { bubbles: true, cancelable: true });
		Object.assign(paste, { clipboardData: { getData: () => "1,234.00" } });
		act(() => {
			input.dispatchEvent(paste);
		});
		expect(paste.defaultPrevented).toBe(true);
		expect(onValueChange).toHaveBeenCalledWith(1234);
		expect(input.value).toBe("1.234");
		act(() => root.unmount());
	});
});

describe("Esc trong lịch chọn ngày", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("chỉ đóng lịch, không đóng hộp thoại phiếu đang nhập", () => {
		const onClose = vi.fn();
		function Form() {
			const [date, setDate] = useState("2026-10-10");
			return (
				<Dialog title="Phiếu cước" onConfirm={async () => {}} onClose={onClose}>
					<DateInput value={date} onChange={setDate} />
				</Dialog>
			);
		}
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() => root.render(<Form />));
		const pickerButton = container.querySelector(".datepick") as HTMLButtonElement;
		act(() => pickerButton.click());
		expect(document.querySelector(".vn-date-picker")).not.toBeNull();

		const escape = () =>
			act(() => {
				document.activeElement?.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			});
		escape();
		expect(document.querySelector(".vn-date-picker")).toBeNull();
		expect(onClose).not.toHaveBeenCalled();

		// Lịch đã đóng: Esc lần nữa mới đóng hộp thoại như bình thường.
		escape();
		expect(onClose).toHaveBeenCalledTimes(1);
		act(() => root.unmount());
	});
});
