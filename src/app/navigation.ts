import {
	Building2,
	ChartColumn,
	Database,
	FileChartColumn,
	Fuel,
	History,
	LayoutGrid,
	type LucideIcon,
	Receipt,
	Settings2,
	Truck,
	User,
	Users,
} from "lucide-react";
import type { PageId } from "../types";

export interface NavItem {
	id: PageId;
	label: string;
	icon: LucideIcon;
}

export interface NavGroup {
	label: string;
	items: NavItem[];
}

/**
 * Toàn bộ thẻ của ứng dụng.
 *
 * Thanh điều hướng chỉ hiện những thẻ mà máy chủ đã cấp cho người đang đăng
 * nhập — ẩn menu không phải là phân quyền, máy chủ vẫn kiểm tra lại ở mỗi
 * yêu cầu. Thêm mục ở đây phải thêm cả vào `PAGES` trong server/permissions.cjs.
 */
export const navGroups: NavGroup[] = [
	{
		label: "Theo dõi",
		items: [
			{ id: "dashboard", label: "Tổng quan", icon: LayoutGrid },
			{ id: "entries", label: "Nhập chi phí gửi hàng", icon: Receipt },
			{ id: "misa", label: "Dữ liệu MISA", icon: Database },
		],
	},
	{
		label: "Vận hành",
		items: [
			{ id: "employees", label: "Nhân viên", icon: User },
			{ id: "customers", label: "Khách hàng", icon: Building2 },
			{ id: "carriers", label: "Nhà xe", icon: Truck },
			{ id: "fuel", label: "Tính giá xăng", icon: Fuel },
		],
	},
	{
		label: "Báo cáo",
		items: [
			{ id: "reports_employee", label: "Cước nhân viên", icon: ChartColumn },
			{ id: "reports_carrier", label: "Cước nhà xe", icon: FileChartColumn },
		],
	},
	{
		label: "Hệ thống",
		items: [
			{ id: "users", label: "Người dùng", icon: Users },
			{ id: "audit", label: "Nhật ký hoạt động", icon: History },
			{ id: "settings", label: "Cài đặt", icon: Settings2 },
		],
	},
];

/** Chỉ giữ lại nhóm và mục mà người dùng được phép mở. */
export function visibleGroups(pages: PageId[]): NavGroup[] {
	return navGroups
		.map((group) => ({
			...group,
			items: group.items.filter((item) => pages.includes(item.id)),
		}))
		.filter((group) => group.items.length > 0);
}
