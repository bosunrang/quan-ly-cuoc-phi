import { normalizeText } from "../../shared/lib/text";

/** Phiếu cước gửi hàng. */
export interface Entry {
	id: number;
	entryDate: string;
	customer: string;
	carrier: string;
	recipient: string;
	address: string;
	spec: string;
	ticketFee: number;
	transportFee: number;
	/** Cước đang thiết lập trong bảng giá; null khi không tìm thấy mức phù hợp. */
	standardTransportFee: number | null;
	gateFee: number;
	otherFeeName: string;
	otherFee: number;
	/** Máy chủ tự cộng các khoản phí, giao diện không tự tính. */
	totalFee: number;
	note: string;
	rateVarianceNote: string;
	duplicateReason: string;
	billStatus: BillStatus;
	misaDocumentDate?: string;
	misaDocumentCode?: string;
	createdBy: number;
	createdByName: string | null;
	employeeId?: number | null;
	employeeName?: string | null;
	/** Mã trong danh mục; null khi khách hàng/nhà xe chưa có hoặc đã bị xóa. */
	customerId?: number | null;
	carrierId?: number | null;
	/** Admin được quản lý mọi phiếu; nhân viên chỉ quản lý phiếu tự tạo. */
	canEdit: boolean;
	canDelete: boolean;
	createdAt: string;
	updatedAt: string;
}

/** Dữ liệu gửi lên khi tạo hoặc sửa. Không có createdBy: máy chủ tự điền. */
export interface EntryInput {
	entryDate: string;
	/** Khóa khách hàng dùng khi lưu trực tiếp thông tin giao nhận vào danh mục. */
	customerId?: number;
	customer: string;
	/** Mã nhà xe đã chọn trong danh mục; máy chủ dùng để nối phiếu với bảng cước. */
	carrierId?: number;
	carrier: string;
	recipient: string;
	address: string;
	spec: string;
	ticketFee: number;
	transportFee: number;
	gateFee: number;
	/** Khoản phát sinh khác của chính phiếu giao hàng. */
	otherFeeName: string;
	otherFee: number;
	note: string;
	rateVarianceNote: string;
	/** Chỉ bắt buộc khi trùng ngày gửi và khách hàng. */
	duplicateReason: string;
	billStatus: BillStatus;
	misaDocumentDate?: string;
	misaDocumentCode?: string;
	/** Admin chọn nhân viên phụ trách; máy chủ vẫn xác minh nhân viên đang hoạt động. */
	employeeId?: number;
	/** Chỉ dùng lúc lưu phiếu: đồng thời cập nhật bảng cước của cặp khách hàng – nhà xe. */
	saveCarrierRate: boolean;
}

/** Các quy cách gợi ý khi cặp khách hàng – nhà xe chưa thiết lập bảng cước. */
export const DEFAULT_ENTRY_RATE_SPECS = [
	"Tất cả",
	"Thùng nhỏ",
	"Thùng trung",
	"Thùng lớn",
	"Khác",
] as const;

export interface EntryFormOptions {
	currentUserId: number;
	currentUserName: string;
	isAdmin: boolean;
	customers: Array<{
		id: number;
		name: string;
		customerCode: string;
		provinceCity: string;
	}>;
	carriers: EntryCarrierOption[];
	employees: Array<{ id: number; name: string; userId: number | null }>;
}

export interface EntryCarrierOption {
	id: number;
	name: string;
}

export interface EntryCarrierChoice extends EntryCarrierOption {
	isLinked: boolean;
}

export interface EntryCustomerContext {
	customer: { id: number; name: string; recipient: string; address: string };
	carriers: EntryCarrierOption[];
	recipients: string[];
	defaultCarrierId: number | null;
}

/**
 * Sau khi chọn khách hàng, đưa nhà xe đã liên kết lên đầu rồi bổ sung phần còn lại
 * của danh mục. Mỗi nhà xe chỉ xuất hiện một lần.
 * Context null nghĩa là thông tin khách hàng chưa tải xong, nên chưa hiển thị lựa chọn.
 */
export function entryCarrierOptions(
	allCarriers: EntryCarrierOption[],
	context: EntryCustomerContext | null,
): EntryCarrierChoice[] {
	if (!context) return [];
	const choices = new Map<number, EntryCarrierChoice>();
	for (const carrier of context.carriers) {
		choices.set(carrier.id, { ...carrier, isLinked: true });
	}
	for (const carrier of allCarriers) {
		if (!choices.has(carrier.id)) {
			choices.set(carrier.id, { ...carrier, isLinked: false });
		}
	}
	return [...choices.values()];
}

/** Chỉ tự điền khi khách hàng có duy nhất một người nhận đã lưu. */
export function defaultEntryRecipient(recipients: string[]): string {
	return recipients.length === 1 ? recipients[0] : "";
}

export interface MisaOrder {
	documentDate: string;
	documentCode: string;
	items: Array<{ productName: string; quantity: number }>;
	totalQuantity: number;
	note: string;
}

export interface EntryRate {
	id: number;
	spec: string;
	isDefault: boolean;
	transportFee: number;
	gateFee: number;
	note: string;
}

export type BillStatus = "" | "Có bill" | "Không bill";

/** Một quy cách có sẵn trong bảng cước hoặc là gợi ý để tạo mức mới. */
export interface EntryRateChoice extends EntryRate {
	isAssigned: boolean;
}

/** Đưa quy cách đã gán lên đầu, sau đó thêm quy cách mặc định còn thiếu. */
export function entryRateOptions(rates: EntryRate[]): EntryRateChoice[] {
	const assigned = rates.map((rate) => ({ ...rate, isAssigned: true }));
	const assignedKeys = new Set(rates.map((rate) => normalizeText(rate.spec)));
	const newOptions = DEFAULT_ENTRY_RATE_SPECS.filter(
		(spec) => !assignedKeys.has(normalizeText(spec)),
	).map((spec, index) => ({
		id: -(index + 1),
		spec,
		isDefault: spec === "Tất cả",
		transportFee: 0,
		gateFee: 0,
		note: "",
		isAssigned: false,
	}));
	return [...assigned, ...newOptions];
}

export interface EntryFilters {
	from?: string;
	to?: string;
	search?: string;
	employeeId?: string;
	limit?: string;
	offset?: string;
}

export interface EntryListResult {
	items: Entry[];
	count: number;
	total: number;
	/** "own" = phiếu được giao cho mình, "all" = mọi phiếu (chỉ Admin). */
	scope: "own" | "all";
}

export function emptyEntryInput(entryDate: string): EntryInput {
	return {
		entryDate,
		customerId: undefined,
		customer: "",
		carrierId: undefined,
		carrier: "",
		recipient: "",
		address: "",
		spec: "",
		ticketFee: 0,
		transportFee: 0,
		gateFee: 0,
		otherFeeName: "",
		otherFee: 0,
		note: "",
		rateVarianceNote: "",
		duplicateReason: "",
		billStatus: "",
		misaDocumentDate: "",
		misaDocumentCode: "",
		employeeId: undefined,
		saveCarrierRate: false,
	};
}

export function toEntryInput(entry: Entry): EntryInput {
	return {
		entryDate: entry.entryDate,
		customerId: entry.customerId ?? undefined,
		customer: entry.customer,
		carrierId: entry.carrierId ?? undefined,
		carrier: entry.carrier,
		recipient: entry.recipient,
		address: entry.address,
		spec: entry.spec,
		ticketFee: entry.ticketFee,
		transportFee: entry.transportFee,
		gateFee: entry.gateFee,
		otherFeeName: entry.otherFeeName,
		otherFee: entry.otherFee,
		note: entry.note,
		rateVarianceNote: entry.rateVarianceNote,
		duplicateReason: entry.duplicateReason,
		billStatus: entry.billStatus,
		misaDocumentDate: entry.misaDocumentDate ?? "",
		misaDocumentCode: entry.misaDocumentCode ?? "",
		employeeId: entry.employeeId ?? undefined,
		saveCarrierRate: false,
	};
}

/**
 * Kiểm tra trước khi gửi để báo lỗi ngay tại biểu mẫu.
 * Máy chủ vẫn kiểm tra lại — đây chỉ là lớp tiện lợi cho người dùng.
 */
export function validateEntry(
	input: EntryInput,
	{ requireEmployee = false }: { requireEmployee?: boolean } = {},
): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate))
		return "Vui lòng chọn ngày.";
	if (requireEmployee && !input.employeeId)
		return "Vui lòng chọn nhân viên phụ trách.";
	if (!input.customer.trim()) return "Vui lòng nhập tên khách hàng.";
	if (!input.carrier.trim()) return "Vui lòng nhập nhà xe.";
	if (!input.spec.trim()) return "Vui lòng nhập quy cách.";
	if (!input.billStatus) return "Vui lòng chọn bill.";
	if (!input.note.trim()) return "Vui lòng nhập sản phẩm.";
	for (const [value, label] of [
		[input.ticketFee, "Phí vé"],
		[input.transportFee, "Cước vận chuyển"],
		[input.gateFee, "Phí cổng"],
		[input.otherFee, "Chi phí khác"],
	] as const) {
		if (!Number.isInteger(value)) return `${label} phải là số nguyên.`;
		if (value < 0) return `${label} không được âm.`;
	}
	if (input.otherFee > 0 && !input.otherFeeName.trim())
		return "Vui lòng nhập tên chi phí khác.";
	if (input.otherFeeName.trim() && input.otherFee === 0)
		return "Vui lòng nhập số tiền chi phí khác.";
	if (input.transportFee === 0)
		return "Vui lòng nhập cước vận chuyển lớn hơn 0.";
	return null;
}
