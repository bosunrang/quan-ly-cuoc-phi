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
	gateFee: number;
	/** Máy chủ tự cộng ba khoản phí, giao diện không tự tính. */
	totalFee: number;
	note: string;
	rateVarianceNote: string;
	misaDocumentDate?: string;
	misaDocumentCode?: string;
	createdBy: number;
	createdByName: string | null;
	employeeId?: number | null;
	employeeName?: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Dữ liệu gửi lên khi tạo hoặc sửa. Không có createdBy: máy chủ tự điền. */
export interface EntryInput {
	entryDate: string;
	/** Khóa khách hàng dùng khi lưu trực tiếp thông tin giao nhận vào danh mục. */
	customerId?: number;
	customer: string;
	carrier: string;
	recipient: string;
	address: string;
	spec: string;
	ticketFee: number;
	transportFee: number;
	gateFee: number;
	note: string;
	rateVarianceNote: string;
	misaDocumentDate?: string;
	misaDocumentCode?: string;
	/** Admin chọn nhân viên phụ trách; máy chủ vẫn xác minh nhân viên đang hoạt động. */
	employeeId?: number;
}

export interface EntryFormOptions {
	currentUserId: number;
	currentUserName: string;
	isAdmin: boolean;
	customers: Array<{ id: number; name: string; provinceCity: string }>;
	carriers: Array<{ id: number; name: string }>;
	employees: Array<{ id: number; name: string; userId: number | null }>;
}

export interface EntryCustomerContext {
	customer: { id: number; name: string; recipient: string; address: string };
	carriers: Array<{ id: number; name: string }>;
	recipients: string[];
	defaultCarrierId: number | null;
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

export interface EntryFilters {
	from?: string;
	to?: string;
	search?: string;
	employeeId?: string;
}

export interface EntryListResult {
	items: Entry[];
	count: number;
	total: number;
	/** "own" = chỉ phiếu của mình, "all" = mọi phiếu (chỉ Admin). */
	scope: "own" | "all";
}

export function emptyEntryInput(entryDate: string): EntryInput {
	return {
		entryDate,
		customerId: undefined,
		customer: "",
		carrier: "",
		recipient: "",
		address: "",
		spec: "",
		ticketFee: 0,
		transportFee: 0,
		gateFee: 0,
		note: "",
		rateVarianceNote: "",
		misaDocumentDate: "",
		misaDocumentCode: "",
		employeeId: undefined,
	};
}

export function toEntryInput(entry: Entry): EntryInput {
	return {
		entryDate: entry.entryDate,
		customerId: undefined,
		customer: entry.customer,
		carrier: entry.carrier,
		recipient: entry.recipient,
		address: entry.address,
		spec: entry.spec,
		ticketFee: entry.ticketFee,
		transportFee: entry.transportFee,
		gateFee: entry.gateFee,
		note: entry.note,
		rateVarianceNote: entry.rateVarianceNote,
		misaDocumentDate: entry.misaDocumentDate ?? "",
		misaDocumentCode: entry.misaDocumentCode ?? "",
		employeeId: entry.employeeId ?? undefined,
	};
}

/**
 * Kiểm tra trước khi gửi để báo lỗi ngay tại biểu mẫu.
 * Máy chủ vẫn kiểm tra lại — đây chỉ là lớp tiện lợi cho người dùng.
 */
export function validateEntry(input: EntryInput): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate))
		return "Vui lòng chọn ngày.";
	if (!input.customer.trim()) return "Vui lòng nhập tên khách hàng.";
	if (!input.carrier.trim()) return "Vui lòng nhập nhà xe.";
	for (const [value, label] of [
		[input.ticketFee, "Phí vé"],
		[input.transportFee, "Cước vận chuyển"],
		[input.gateFee, "Phí cổng"],
	] as const) {
		if (!Number.isInteger(value)) return `${label} phải là số nguyên.`;
		if (value < 0) return `${label} không được âm.`;
	}
	return null;
}
