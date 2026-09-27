import { api } from "../../shared/api/client";
import type {
	Customer,
	CustomerImportKeys,
	CustomerImportResult,
	CustomerInput,
	CustomerListResult,
} from "./customer.model";

export const customerRepository = {
	importKeys(): Promise<CustomerImportKeys> {
		return api<CustomerImportKeys>("GET", "/api/customers/import-keys");
	},
	list(search = "", page = 1, limit = 50): Promise<CustomerListResult> {
		const query = new URLSearchParams();
		if (search.trim()) query.set("search", search);
		query.set("page", String(page));
		query.set("limit", String(limit));
		return api<CustomerListResult>("GET", `/api/customers?${query}`);
	},
	create(input: CustomerInput): Promise<Customer> {
		return api<Customer>("POST", "/api/customers", input);
	},
	update(id: number, input: CustomerInput): Promise<Customer> {
		return api<Customer>("PATCH", `/api/customers/${id}`, input);
	},
	remove(id: number): Promise<{ ok: true }> {
		return api<{ ok: true }>("DELETE", `/api/customers/${id}`);
	},
	import(rows: CustomerInput[]): Promise<CustomerImportResult> {
		return api<CustomerImportResult>(
			"POST",
			"/api/customers/import",
			{ rows },
			{ timeoutMs: 120_000 },
		);
	},
};
