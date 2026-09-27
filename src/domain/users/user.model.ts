import type { PageId } from "../../types";

export interface ManagedUser {
	id: number;
	username: string;
	fullName: string;
	isAdmin: boolean;
	isActive: boolean;
	/** Thẻ người này được mở. Admin luôn có toàn bộ. */
	pages: PageId[];
	createdAt: string;
}

/** Một thẻ có thể cấp cho nhân viên. Máy chủ quyết định danh sách này. */
export interface GrantablePage {
	key: PageId;
	label: string;
	description: string;
}

export interface CreateUserInput {
	username: string;
	fullName: string;
	password: string;
	/** Tài khoản toàn quyền, không cần cấp từng thẻ. */
	isAdmin: boolean;
	pages: PageId[];
}

export interface UpdateUserInput {
	fullName?: string;
	isActive?: boolean;
	pages?: PageId[];
}

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

export function validateNewUser(input: CreateUserInput): string | null {
	if (!USERNAME_PATTERN.test(input.username)) {
		return "Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch ngang; dài 3–32 ký tự.";
	}
	if (!input.fullName.trim()) return "Vui lòng nhập họ tên.";
	return validatePassword(input.password);
}

export function validatePassword(password: string): string | null {
	if (password.length < MIN_PASSWORD_LENGTH) {
		return `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
	}
	return null;
}
