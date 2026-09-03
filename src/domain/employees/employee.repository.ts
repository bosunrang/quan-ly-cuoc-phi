import { api } from "../../shared/api/client";
import type {
	Employee,
	EmployeeInput,
	EmployeeListResult,
} from "./employee.model";

export const employeeRepository = {
	list: (search = ""): Promise<EmployeeListResult> =>
		api("GET", `/api/employees?search=${encodeURIComponent(search)}`),
	create: (input: EmployeeInput): Promise<Employee> =>
		api("POST", "/api/employees", input),
	update: (id: number, input: EmployeeInput): Promise<Employee> =>
		api("PATCH", `/api/employees/${id}`, input),
	remove: (id: number): Promise<{ ok: true }> =>
		api("DELETE", `/api/employees/${id}`),
};
