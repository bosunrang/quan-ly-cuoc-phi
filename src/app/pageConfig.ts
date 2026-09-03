import type { PageId } from "../types";

interface PageMeta {
	title: string;
	subtitle: string;
}

/** Tiêu đề và mô tả hiện trên thanh header của từng thẻ. */
export const pageConfig: Record<PageId, PageMeta> = {
	dashboard: {
		title: "Tổng quan",
		subtitle: "Tình hình cước phí và hoạt động gần đây",
	},
	entries: {
		title: "Nhập chi phí gửi hàng",
		subtitle: "Nhập và theo dõi phiếu cước gửi hàng",
	},
	misa: {
		title: "Dữ liệu MISA",
		subtitle: "Nhập và đối chiếu dữ liệu từ phần mềm MISA",
	},
	employees: {
		title: "Nhân viên",
		subtitle: "Hồ sơ nhân viên phụ trách gửi hàng",
	},
	customers: {
		title: "Danh sách khách hàng",
		subtitle: "Danh mục khách hàng dùng chung cho mọi phiếu",
	},
	carriers: {
		title: "Danh sách nhà xe",
		subtitle: "Chành xe, địa chỉ, liên hệ và giờ xe chạy",
	},
	fuel: {
		title: "Tính giá xăng",
		subtitle: "Quy đổi chi phí nhiên liệu theo quãng đường",
	},
	reports_employee: {
		title: "Báo cáo cước nhân viên",
		subtitle: "Tổng hợp chi phí giao hàng theo nhân viên và kỳ báo cáo",
	},
	reports_carrier: {
		title: "Báo cáo cước nhà xe",
		subtitle: "Đối chiếu giá thiết lập với cước thực tế theo nhà xe",
	},
	users: {
		title: "Người dùng & phân quyền",
		subtitle: "Quản lý tài khoản và thẻ truy cập của từng nhân viên",
	},
	audit: {
		title: "Nhật ký hoạt động",
		subtitle: "Theo dõi lịch sử thay đổi và các thao tác quan trọng",
	},
	settings: {
		title: "Cài đặt",
		subtitle: "Cấu hình dữ liệu, sao lưu và hiển thị hệ thống",
	},
};
