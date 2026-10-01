export interface Customer {
	id: number;
	customerName: string;
	customerCode: string;
	carrier: string;
	address: string;
	createdAt: string;
	updatedAt: string;
}

export interface CustomerInput {
	customerName: string;
	customerCode: string;
	carrier: string;
	address: string;
}

export interface CustomerImportKeys {
	items: Array<{
		nameKey: string;
		codeKey: string;
	}>;
}

export interface CustomerImportResult {
	inserted: number;
	updated: number;
	duplicates: number;
}

export interface CustomerListResult {
	items: Customer[];
	count: number;
	resultCount: number;
	carrierCount: number;
	addressCount: number;
	page: number;
	pageSize: number;
	pageCount: number;
}

export const emptyCustomerInput = (): CustomerInput => ({
	customerName: "",
	customerCode: "",
	carrier: "",
	address: "",
});

export function toCustomerInput(customer: Customer): CustomerInput {
	return {
		customerName: customer.customerName,
		customerCode: customer.customerCode,
		carrier: customer.carrier,
		address: customer.address,
	};
}

export function validateCustomer(input: CustomerInput): string | null {
	if (!input.customerName.trim()) return "Vui lòng nhập tên khách hàng.";
	if (input.customerName.trim().length > 300)
		return "Tên khách hàng không được dài quá 300 ký tự.";
	return null;
}
