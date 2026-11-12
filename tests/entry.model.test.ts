import { describe, expect, it } from "vitest";
import type { Entry } from "../src/domain/entries/entry.model";
import {
	DEFAULT_ENTRY_RATE_SPECS,
	defaultEntryRecipient,
	emptyEntryInput,
	entryCarrierOptions,
	entryRateOptions,
	entryTransportFee,
	toEntryInput,
	validateEntry,
} from "../src/domain/entries/entry.model";

const valid = {
	...emptyEntryInput("2026-08-29"),
	customer: "Công ty ABC",
	carrier: "Nhà xe Anh Sáu",
	recipient: "Chị Lan",
	address: "105 Hàm Nghi",
	spec: "Thùng 20kg",
	transportFee: 350_000,
	transportUnitFee: null,
	note: "20 thùng hàng",
	billStatus: "Có bill" as const,
};

describe("kiểm tra phiếu cước", () => {
	it("nhân đơn giá với số lượng, không nhân phí cổng và không tính lại tổng cước cũ", () => {
		const input = {
			...valid,
			quantity: 5,
			transportUnitFee: 50_000,
			gateFee: 10_000,
		};
		expect(entryTransportFee(input)).toBe(250_000);
		expect(validateEntry(input)).toBeNull();
		expect(entryTransportFee({ ...input, quantity: 2 })).toBe(100_000);
		expect(entryTransportFee({ ...input, quantity: null })).toBe(50_000);
		expect(entryTransportFee({ ...input, transportUnitFee: null })).toBe(
			350_000,
		);
		expect(validateEntry({ ...input, transportUnitFee: -1 })).toContain(
			"Đơn giá",
		);
		expect(validateEntry({ ...input, transportUnitFee: 1.5 })).toContain(
			"Đơn giá",
		);
		expect(validateEntry({ ...input, quantity: 100_000_000 })).toContain(
			"giới hạn",
		);
	});
	it("chấp nhận phiếu hợp lệ", () => {
		expect(validateEntry(valid)).toBeNull();
	});

	it("cho phép giao trực tiếp không tính cước, kể cả khi giao nhiều đơn vị", () => {
		expect(validateEntry({ ...valid, transportFee: 0 })).toBeNull();
		const freeDelivery = { ...valid, quantity: 5, transportUnitFee: 0 };
		expect(validateEntry(freeDelivery)).toBeNull();
		expect(entryTransportFee(freeDelivery)).toBe(0);
		expect(validateEntry({ ...freeDelivery, gateFee: 10_000 })).toBeNull();
		expect(validateEntry({ ...valid, transportFee: -1 })).toContain(
			"không được âm",
		);
	});

	it("mặc định số lượng là 1, cho phép bỏ trống và chỉ nhận số nguyên dương", () => {
		expect(emptyEntryInput("2026-08-29").quantity).toBe(1);
		expect(validateEntry({ ...valid, quantity: null })).toBeNull();
		expect(validateEntry({ ...valid, quantity: 3 })).toBeNull();
		for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(validateEntry({ ...valid, quantity })).toBe(
				"Số lượng phải là số nguyên lớn hơn 0.",
			);
		}
	});

	it("từ chối ngày sai định dạng", () => {
		expect(validateEntry({ ...valid, entryDate: "29/08/2026" })).toBe(
			"Vui lòng chọn ngày.",
		);
	});

	it("từ chối thiếu trường bắt buộc", () => {
		expect(validateEntry({ ...valid, customer: "   " })).toContain(
			"tên khách hàng",
		);
		expect(validateEntry({ ...valid, carrier: "" })).toContain("nhà xe");
		expect(validateEntry({ ...valid, spec: "" })).toContain("quy cách");
		expect(validateEntry({ ...valid, billStatus: "" })).toContain("bill");
		expect(validateEntry({ ...valid, note: "" })).toContain("sản phẩm");
		expect(validateEntry(valid, { requireEmployee: true })).toContain(
			"nhân viên phụ trách",
		);
	});

	it("từ chối tiền âm và tiền không nguyên", () => {
		expect(validateEntry({ ...valid, gateFee: -1 })).toBe(
			"Phí cổng không được âm.",
		);
		expect(validateEntry({ ...valid, ticketFee: 1.5 })).toBe(
			"Phí vé phải là số nguyên.",
		);
		expect(validateEntry({ ...valid, otherFee: -1 })).toBe(
			"Chi phí khác không được âm.",
		);
		expect(validateEntry({ ...valid, otherFee: 20_000 })).toBe(
			"Vui lòng nhập tên chi phí khác.",
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
			quantity: 3,
			ticketFee: 20_000,
			transportFee: 350_000,
			standardTransportFee: 350_000,
			gateFee: 15_000,
			otherFeeName: "",
			otherFee: 0,
			totalFee: 385_000,
			note: "",
			generalNote: "Giao buổi sáng",
			rateVarianceNote: "",
			duplicateReason: "",
			billStatus: "Có bill",
			createdBy: 2,
			createdByName: "Nhân viên A",
			canEdit: true,
			canDelete: true,
			createdAt: "2026-08-29T07:00:00.000Z",
			updatedAt: "2026-08-29T07:00:00.000Z",
		};

		const input = toEntryInput(entry);
		// Không được gửi lên: máy chủ tự quyết người tạo và tổng tiền.
		expect(input).not.toHaveProperty("id");
		expect(input).not.toHaveProperty("createdBy");
		expect(input).not.toHaveProperty("totalFee");
		expect(input.customer).toBe("Công ty ABC");
		expect(input.generalNote).toBe("Giao buổi sáng");
		expect(input.quantity).toBe(3);
		// Phiếu cũ có tổng tiền không chia hết: giữ tổng gốc khi chỉ sửa ghi chú.
		expect(input.transportUnitFee).toBeNull();
		expect(entryTransportFee(input)).toBe(350_000);
		const priced = toEntryInput({
			...entry,
			quantity: 5,
			transportFee: 250_000,
			transportUnitFee: 50_000,
		});
		expect(priced.transportUnitFee).toBe(50_000);
		expect(entryTransportFee(priced)).toBe(250_000);
		expect(entryTransportFee({ ...priced, quantity: 2 })).toBe(100_000);
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
