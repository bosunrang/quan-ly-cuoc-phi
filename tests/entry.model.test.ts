import { describe, expect, it } from "vitest";
import type { Entry } from "../src/domain/entries/entry.model";
import {
	DEFAULT_ENTRY_RATE_SPECS,
	defaultEntryRecipient,
	emptyEntryInput,
	entryCarrierOptions,
	entryRateOptions,
	toEntryInput,
	validateEntry,
} from "../src/domain/entries/entry.model";

const valid = {
	...emptyEntryInput("2026-08-29"),
	customer: "Công ty ABC",
	carrier: "Nhà xe Anh Sáu",
	transportFee: 350_000,
};

describe("kiểm tra phiếu cước", () => {
	it("chấp nhận phiếu hợp lệ", () => {
		expect(validateEntry(valid)).toBeNull();
	});

	it("từ chối ngày sai định dạng", () => {
		expect(validateEntry({ ...valid, entryDate: "29/08/2026" })).toBe(
			"Vui lòng chọn ngày.",
		);
	});

	it("từ chối thiếu khách hàng hoặc nhà xe", () => {
		expect(validateEntry({ ...valid, customer: "   " })).toContain(
			"tên khách hàng",
		);
		expect(validateEntry({ ...valid, carrier: "" })).toContain("nhà xe");
	});

	it("từ chối tiền âm và tiền không nguyên", () => {
		expect(validateEntry({ ...valid, gateFee: -1 })).toBe(
			"Phí cổng không được âm.",
		);
		expect(validateEntry({ ...valid, ticketFee: 1.5 })).toBe(
			"Phí vé phải là số nguyên.",
		);
	});
});

describe("chuyển phiếu sang dữ liệu biểu mẫu", () => {
	it("bỏ các trường do máy chủ quản lý", () => {
		const entry: Entry = {
			id: 7,
			entryDate: "2026-08-29",
			customer: "Công ty ABC",
			carrier: "Nhà xe Anh Sáu",
			recipient: "Chị Lan",
			address: "105 Hàm Nghi",
			spec: "Thùng 20kg",
			ticketFee: 20_000,
			transportFee: 350_000,
			standardTransportFee: 350_000,
			gateFee: 15_000,
			totalFee: 385_000,
			note: "",
			rateVarianceNote: "",
			createdBy: 2,
			createdByName: "Nhân viên A",
			createdAt: "2026-08-29T07:00:00.000Z",
			updatedAt: "2026-08-29T07:00:00.000Z",
		};

		const input = toEntryInput(entry);
		// Không được gửi lên: máy chủ tự quyết người tạo và tổng tiền.
		expect(input).not.toHaveProperty("id");
		expect(input).not.toHaveProperty("createdBy");
		expect(input).not.toHaveProperty("totalFee");
		expect(input.customer).toBe("Công ty ABC");
	});
});

describe("lọc nhà xe theo khách hàng", () => {
	const allCarriers = [
		{ id: 1, name: "Nhà xe A" },
		{ id: 2, name: "Nhà xe B" },
		{ id: 3, name: "Nhà xe C" },
	];
	const customer = {
		id: 10,
		name: "Khách hàng A",
		recipient: "",
		address: "",
	};

	it("đưa nhà xe đã liên kết lên đầu và vẫn giữ các lựa chọn khác", () => {
		expect(
			entryCarrierOptions(allCarriers, {
				customer,
				carriers: [allCarriers[0], allCarriers[2]],
				recipients: [],
				defaultCarrierId: null,
			}),
		).toEqual([
			{ ...allCarriers[0], isLinked: true },
			{ ...allCarriers[2], isLinked: true },
			{ ...allCarriers[1], isLinked: false },
		]);
	});

	it("cho phép chọn từ danh mục chung khi khách chưa có liên kết", () => {
		expect(
			entryCarrierOptions(allCarriers, {
				customer,
				carriers: [],
				recipients: [],
				defaultCarrierId: null,
			}),
		).toEqual(allCarriers.map((carrier) => ({ ...carrier, isLinked: false })));
	});

	it("không hiện danh mục chung trong lúc đang tải liên kết", () => {
		expect(entryCarrierOptions(allCarriers, null)).toEqual([]);
	});
});

describe("chọn người nhận theo khách hàng", () => {
	it("tự điền khi chỉ có một người nhận", () => {
		expect(defaultEntryRecipient(["Bác sĩ Triều"])).toBe("Bác sĩ Triều");
	});

	it("để trống khi có nhiều người nhận để người dùng lựa chọn", () => {
		expect(defaultEntryRecipient(["Bác sĩ Triều", "Chị Lan"])).toBe("");
	});

	it("để trống khi khách hàng chưa có người nhận", () => {
		expect(defaultEntryRecipient([])).toBe("");
	});
});

describe("quy cách gợi ý khi chưa có bảng cước", () => {
	it("có đủ các quy cách mặc định để tạo mức cước đầu tiên", () => {
		expect(DEFAULT_ENTRY_RATE_SPECS).toEqual([
			"Tất cả",
			"Thùng nhỏ",
			"Thùng trung",
			"Thùng lớn",
			"Khác",
		]);
	});

	it("đưa quy cách đã gán lên đầu và giữ quy cách mới ở bên dưới", () => {
		const assigned = [
			{
				id: 7,
				spec: "Tất cả",
				isDefault: true,
				transportFee: 50_000,
				gateFee: 0,
				note: "",
			},
			{
				id: 8,
				spec: "Hàng lạnh",
				isDefault: false,
				transportFee: 80_000,
				gateFee: 10_000,
				note: "",
			},
		];
		const choices = entryRateOptions(assigned);
		expect(choices.slice(0, 2)).toEqual(
			assigned.map((rate) => ({ ...rate, isAssigned: true })),
		);
		expect(choices.slice(2).map((rate) => rate.spec)).toEqual([
			"Thùng nhỏ",
			"Thùng trung",
			"Thùng lớn",
			"Khác",
		]);
		expect(choices.slice(2).every((rate) => !rate.isAssigned)).toBe(true);
	});
});
