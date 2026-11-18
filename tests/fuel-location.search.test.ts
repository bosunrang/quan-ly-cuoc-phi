import { describe, expect, it } from "vitest";
import type { FuelData } from "../src/domain/fuel/fuel.repository";
import {
	exactFuelLocations,
	searchFuelLocations,
} from "../src/domain/fuel/location.search";

const location = (
	id: number,
	name: string,
	address = "",
	deliveryPoint = "",
): FuelData["locations"][number] => ({
	id,
	name,
	address,
	deliveryPoint,
	type: "customer",
});

describe("tìm 20 điểm phù hợp nhất", () => {
	it("xếp chính xác, đầu tên, chứa tên trước địa chỉ rồi mới giới hạn 20", () => {
		const addresses = Array.from({ length: 30 }, (_, index) =>
			location(index, `Bệnh viện ${index}`, "48A đường Tăng Nhơn Phú"),
		);
		const exact = location(100, "Tăng Nhơn Phú");
		const prefix = location(101, "Tăng Nhơn Phú - Cơ sở 2");
		const contains = location(102, "TYT Phường Tăng Nhơn Phú");
		const result = searchFuelLocations(
			[...addresses, contains, prefix, exact],
			"tang nhon phu",
		);
		expect(result).toHaveLength(20);
		expect(result.slice(0, 3)).toEqual([exact, prefix, contains]);
		expect(result.slice(3)).toEqual(addresses.slice(0, 17));
		expect(new Set(result.map((item) => item.id)).size).toBe(20);
	});
	it("tìm không dấu, không phân biệt hoa thường và khớp các từ trong tên", () => {
		const item = location(1, "Trạm Y Tế Phường Tăng Nhơn Phú");
		expect(searchFuelLocations([item], " TĂNG   NHƠN PHÚ ")).toEqual([item]);
		expect(searchFuelLocations([item], "tang phu tram")).toEqual([item]);
	});
	it("ưu tiên địa chỉ chính xác/đầu địa chỉ và tìm cả điểm giao nhà xe", () => {
		const contains = location(1, "Bệnh viện A", "1048A Phạm Văn Thuận");
		const prefix = location(2, "Bệnh viện B", "48A Tăng Nhơn Phú");
		const exact = location(3, "Nhà xe", "", "48A");
		expect(searchFuelLocations([contains, prefix, exact], "48a")).toEqual([
			exact,
			prefix,
			contains,
		]);
		expect(searchFuelLocations([prefix], "benh vien tang nhon")).toEqual([
			prefix,
		]);
	});
	it("từ khóa rỗng chỉ lấy 20 điểm đầu, không có kết quả thì trả danh sách rỗng", () => {
		const items = Array.from({ length: 25 }, (_, index) =>
			location(index, `Điểm ${index}`),
		);
		expect(searchFuelLocations(items, "")).toEqual(items.slice(0, 20));
		expect(searchFuelLocations(items, "không tồn tại")).toEqual([]);
	});
	it("giữ nguyên nhận dạng điểm và không tự chọn khi tên bị trùng", () => {
		const a = location(1, "Đơn vị A", "Hà Nội");
		const b = location(2, "Đơn vị A", "Hải Phòng");
		expect(exactFuelLocations([a, b], "don vi a")).toEqual([a, b]);
		expect(exactFuelLocations([a], "ĐƠN VỊ A")[0]).toBe(a);
	});
});
