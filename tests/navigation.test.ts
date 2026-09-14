import { describe, expect, it } from "vitest";
import { navGroups, visibleGroups } from "../src/app/navigation";
import { pageConfig } from "../src/app/pageConfig";
import type { PageId } from "../src/types";

describe("thanh điều hướng theo quyền", () => {
	it("nhân viên chỉ được cấp thẻ nhập cước thì chỉ thấy nhóm Theo dõi & vận hành", () => {
		const groups = visibleGroups(["entries"]);
		expect(groups).toHaveLength(1);
		expect(groups[0].label).toBe("Theo dõi & vận hành");
		expect(groups[0].items.map((item) => item.id)).toEqual(["entries"]);
	});

	it("không cấp thẻ nào thì không hiện nhóm nào", () => {
		expect(visibleGroups([])).toEqual([]);
	});

	it("Admin thấy đủ mọi nhóm", () => {
		const all = navGroups.flatMap((group) =>
			group.items.map((item) => item.id),
		) as PageId[];
		expect(visibleGroups(all).flatMap((group) => group.items)).toHaveLength(
			all.length,
		);
	});

	it("giữ đúng cấu trúc menu nghiệp vụ đã duyệt", () => {
		expect(
			navGroups.map((group) => ({
				label: group.label,
				items: group.items.map((item) => item.label),
			})),
		).toEqual([
			{
				label: "Theo dõi & vận hành",
				items: ["Tổng quan", "Nhập chi phí gửi hàng", "Tính giá xăng"],
			},
			{
				label: "Dữ liệu",
				items: ["Dữ liệu MISA", "Khách hàng", "Nhân viên", "Nhà xe"],
			},
			{
				label: "Báo cáo",
				items: ["Cước gửi hàng", "Cước chênh lệch", "Chi phí tiền xăng"],
			},
			{
				label: "Hệ thống",
				items: ["Người dùng", "Nhật ký hoạt động", "Cài đặt"],
			},
		]);
	});
});

describe("cấu hình trang", () => {
	it("mọi mục điều hướng đều có tiêu đề và mô tả", () => {
		for (const item of navGroups.flatMap((group) => group.items)) {
			expect(pageConfig[item.id]?.title, item.id).toBeTruthy();
			expect(pageConfig[item.id]?.subtitle, item.id).toBeTruthy();
		}
	});

	it("trang báo cáo cước gửi hàng dùng tên mới", () => {
		expect(pageConfig.reports_employee.title).toBe("Báo cáo cước gửi hàng");
	});
});
