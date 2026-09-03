export interface AuditEntry {
	id: number;
	at: string;
	userId: number | null;
	username: string;
	action: string;
	entity: string;
	entityId: string | null;
	detail: unknown;
}

export interface AuditFilters {
	q?: string;
	limit?: number;
	offset?: number;
}

export interface AuditResult {
	items: AuditEntry[];
	total: number;
}

type Tone = "success" | "warning" | "info" | "neutral" | "danger";

const LABELS: Record<string, string> = {
	login: "Đăng nhập",
	"login.failed": "Đăng nhập thất bại",
	logout: "Đăng xuất",
	"entry.create": "Tạo phiếu",
	"entry.update": "Sửa phiếu",
	"entry.delete": "Xóa phiếu",
	"user.create": "Tạo người dùng",
	"user.update": "Sửa người dùng",
	"user.reset_password": "Đặt lại mật khẩu",
	"password.change": "Đổi mật khẩu",
	"password.initial_change": "Đổi mật khẩu mặc định",
	"user.seed_admin": "Khởi tạo quản trị viên",
	"settings.update": "Cập nhật cài đặt",
	"login.dev": "Đăng nhập phát triển",
	"misa.import": "Nhập dữ liệu MISA",
	"report.export": "Xuất báo cáo Excel",
	"fuel.price.upsert": "Cập nhật giá xăng",
	"fuel.price.delete": "Xóa mốc giá xăng",
	"fuel.record.create": "Lưu tính tiền xăng",
	"employee.create": "Thêm nhân viên",
	"employee.update": "Sửa nhân viên",
	"employee.delete": "Xóa nhân viên",
	"customer.create": "Thêm khách hàng",
	"customer.update": "Sửa khách hàng",
	"customer.delete": "Xóa khách hàng",
	"customer.import": "Nhập khách hàng",
	"carrier.create": "Thêm nhà xe",
	"carrier.update": "Sửa nhà xe",
	"carrier.delete": "Xóa nhà xe",
	"carrier.excel.import": "Nhập bảng cước nhà xe",
	"carrier.import": "Nhập nhà xe",
	"carrier.rate.create": "Thêm mức cước",
	"carrier.rate.update": "Sửa mức cước",
	"carrier.rate.delete": "Xóa mức cước",
	"carrier.assign_customers": "Gán khách hàng cho nhà xe",
	"carrier.unassign_customer": "Gỡ khách hàng khỏi nhà xe",
	"audit.cleanup": "Dọn nhật ký",
};

const TONES: Record<string, Tone> = {
	"login.failed": "danger",
	"entry.delete": "danger",
	"entry.create": "success",
	"user.create": "success",
	"employee.create": "success",
	"customer.create": "success",
	"carrier.create": "success",
	"fuel.record.create": "success",
	"entry.update": "info",
	"employee.update": "info",
	"customer.update": "info",
	"carrier.update": "info",
	"fuel.price.upsert": "info",
	"report.export": "neutral",
	"misa.import": "neutral",
	"employee.delete": "danger",
	"customer.delete": "danger",
	"carrier.delete": "danger",
	"fuel.price.delete": "danger",
	login: "neutral",
	logout: "neutral",
};

export const actionLabel = (action: string): string => LABELS[action] ?? action;

export const actionTone = (action: string): Tone => TONES[action] ?? "info";

const ENTITY_LABELS: Record<string, string> = {
	entry: "Phiếu cước",
	fuel_record: "Kỳ tính xăng",
	fuel_price: "Mốc giá xăng",
	report: "Báo cáo",
	misa: "Dữ liệu MISA",
	user: "Người dùng",
	employee: "Nhân viên",
	customer: "Khách hàng",
	carrier: "Nhà xe",
	carrier_customer_rate: "Mức cước",
	settings: "Cài đặt",
	audit_log: "Nhật ký hoạt động",
};

export const entityLabel = (
	entity: string,
	entityId: string | null,
): string => {
	const label = ENTITY_LABELS[entity] ?? entity;
	return entityId ? `${label} #${entityId}` : label;
};
