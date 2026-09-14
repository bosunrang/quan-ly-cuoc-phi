/** Khóa của từng thẻ (màn hình). Phải trùng với PAGES trong server/permissions.cjs. */
export type PageId =
	| "dashboard"
	| "entries"
	| "misa"
	| "employees"
	| "customers"
	| "carriers"
	| "fuel"
	| "reports_employee"
	| "reports_carrier"
	| "reports_fuel_price"
	| "users"
	| "audit"
	| "settings";

export interface CurrentUser {
	id: number;
	username: string;
	fullName: string;
	isAdmin: boolean;
	mustChangePassword: boolean;
}

export interface MenuItem {
	key: PageId;
	label: string;
}

/** Hồ sơ phiên đăng nhập do máy chủ trả về. */
export interface Profile {
	user: CurrentUser;
	pages: PageId[];
	menu: MenuItem[];
}

export interface LoginResult extends Profile {
	token: string;
	expiresAt: string;
}
