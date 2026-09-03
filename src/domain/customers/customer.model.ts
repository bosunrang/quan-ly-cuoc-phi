export interface Customer {
	id: number;
	customerName: string;
	carrier: string;
	recipient: string;
	address: string;
	createdAt: string;
	updatedAt: string;
}

export interface CustomerInput {
	customerName: string;
	carrier: string;
	recipient: string;
	address: string;
}

export interface CustomerListResult {
	items: Customer[];
	count: number;
	resultCount: number;
	carrierCount: number;
	recipientCount: number;
	addressCount: number;
	page: number;
	pageSize: number;
	pageCount: number;
}

export const emptyCustomerInput = (): CustomerInput => ({
	customerName: "",
	carrier: "",
	recipient: "",
	address: "",
});

export function toCustomerInput(customer: Customer): CustomerInput {
	return {
		customerName: customer.customerName,
		carrier: customer.carrier,
		recipient: customer.recipient,
		address: customer.address,
	};
}

export function validateCustomer(input: CustomerInput): string | null {
	if (!input.customerName.trim()) return "Vui lòng nhập tên khách hàng.";
	if (input.customerName.trim().length > 300)
		return "Tên khách hàng không được dài quá 300 ký tự.";
	return null;
}
