export interface Carrier {
	id: number;
	name: string;
	contact: string;
	phone: string;
	address: string;
	schedule: string;
	note: string;
	isActive: boolean;
	assignedCustomerIds: number[];
	createdAt: string;
	updatedAt: string;
}

export interface CarrierInput {
	name: string;
	contact: string;
	phone: string;
	address: string;
	schedule: string;
	note: string;
	isActive: boolean;
}

export interface CarrierListResult {
	items: Carrier[];
	activeCount: number;
	linkCount: number;
	unassignedCustomerCount: number;
}

export interface CarrierCustomerRate {
	id: number;
	spec: string;
	isDefault: boolean;
	transportFee: number;
	gateFee: number;
	note: string;
	createdAt: string;
	updatedAt: string;
}

export interface CarrierCustomerRateInput {
	spec: string;
	isDefault: boolean;
	transportFee: number;
	gateFee: number;
	note: string;
}

export interface CarrierExcelCarrierInput extends CarrierInput {
	rowNumber: number;
}

export interface CarrierExcelRateInput {
	rowNumber: number;
	carrierName: string;
	customerName: string;
	spec: string;
	transportFee: number;
	gateFee: number;
	note: string;
}

export interface CarrierExcelPreviewRow {
	rowNumber: number;
	status: "ready" | "duplicate" | "skipped";
	reason?: string;
	name?: string;
	address?: string;
	phone?: string;
	carrierName?: string;
	customerName?: string;
	spec?: string;
	transportFee?: number;
	gateFee?: number;
}

export interface CarrierExcelPreview {
	carriers: CarrierExcelPreviewRow[];
	rates: CarrierExcelPreviewRow[];
	carrierSummary: Record<"ready" | "duplicate" | "skipped", number>;
	rateSummary: Record<"ready" | "duplicate" | "skipped", number>;
}

export interface CarrierExcelExport {
	carriers: Array<Omit<CarrierInput, "contact">>;
	rates: Array<Omit<CarrierExcelRateInput, "rowNumber">>;
}

export const emptyCarrierCustomerRateInput = (): CarrierCustomerRateInput => ({
	spec: "",
	isDefault: false,
	transportFee: 0,
	gateFee: 0,
	note: "",
});

export const emptyCarrierInput = (): CarrierInput => ({
	name: "",
	contact: "",
	phone: "",
	address: "",
	schedule: "",
	note: "",
	isActive: true,
});
export const toCarrierInput = (carrier: Carrier): CarrierInput => ({
	name: carrier.name,
	contact: carrier.contact,
	phone: carrier.phone,
	address: carrier.address,
	schedule: carrier.schedule,
	note: carrier.note,
	isActive: carrier.isActive,
});
export const validateCarrier = (input: CarrierInput): string | null =>
	input.name.trim() ? null : "Vui lòng nhập tên nhà xe.";
