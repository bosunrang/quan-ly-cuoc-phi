export interface Employee {
	id: number;
	fullName: string;
	address: string;
	userId: number | null;
	linkedUsername: string;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface EmployeeInput {
	fullName: string;
	address: string;
	userId: number | null;
	isActive: boolean;
}

export interface EmployeeListResult {
	items: Employee[];
	count: number;
	activeCount: number;
	linkedUserCount: number;
	addressCount: number;
}

export const emptyEmployeeInput = (): EmployeeInput => ({
	fullName: "",
	address: "",
	userId: null,
	isActive: true,
});

export const toEmployeeInput = (employee: Employee): EmployeeInput => ({
	fullName: employee.fullName,
	address: employee.address,
	userId: employee.userId,
	isActive: employee.isActive,
});

export const validateEmployee = (input: EmployeeInput): string | null =>
	input.fullName.trim() ? null : "Vui lòng nhập họ tên nhân viên.";
