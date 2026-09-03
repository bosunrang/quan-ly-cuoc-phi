export interface AppSettings {
	companyName: string;
	companyAddress: string;
	displayName: string;
	tagline: string;
	logoDataUrl: string | null;
}

export const defaultSettings: AppSettings = {
	companyName: "",
	companyAddress: "",
	displayName: "Cước phí",
	tagline: "Quản lý giao hàng",
	logoDataUrl: null,
};

export type DataGroup =
	| "entries"
	| "misa"
	| "customers"
	| "carriers"
	| "employees"
	| "fuel";

export interface SettingsBackup {
	format: "cuocphi-backup";
	version: 1;
	createdAt: string;
	data: Record<string, unknown[]>;
}
