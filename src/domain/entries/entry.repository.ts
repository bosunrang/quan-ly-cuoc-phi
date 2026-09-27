import { api } from "../../shared/api/client";
import type {
	Entry,
	EntryCustomerContext,
	EntryFilters,
	EntryFormOptions,
	EntryInput,
	EntryListResult,
	EntryRate,
	MisaOrder,
} from "./entry.model";

/**
 * Mọi truy cập dữ liệu phiếu cước đi qua đây. Page không gọi thẳng `api`,
 * để sau này đổi nguồn dữ liệu mà không phải sửa giao diện.
 */
export const entryRepository = {
	list(filters: EntryFilters = {}): Promise<EntryListResult> {
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(filters)) {
			if (value) query.set(key, value);
		}
		return api<EntryListResult>("GET", `/api/entries?${query}`);
	},
	formOptions: (): Promise<EntryFormOptions> =>
		api("GET", "/api/entries/form-options"),
	customerContext: (customerId: number): Promise<EntryCustomerContext> =>
		api("GET", `/api/entries/customer-context?customerId=${customerId}`),
	misaOrders: (
		customerId: number,
		endDate: string,
	): Promise<{ items: MisaOrder[] }> =>
		api(
			"GET",
			`/api/entries/misa-orders?customerId=${customerId}&endDate=${endDate}`,
		),
	rates: (
		customerId: number,
		carrierId: number,
	): Promise<{ items: EntryRate[] }> =>
		api(
			"GET",
			`/api/entries/rates?customerId=${customerId}&carrierId=${carrierId}`,
		),

	duplicateCheck: ({
		entryDate,
		customer,
		excludeId,
	}: {
		entryDate: string;
		customer: string;
		excludeId?: number;
	}): Promise<{ duplicate: boolean }> => {
		const query = new URLSearchParams({ entryDate, customer });
		if (excludeId) query.set("excludeId", String(excludeId));
		return api("GET", `/api/entries/duplicate-check?${query}`);
	},

	create(input: EntryInput): Promise<Entry> {
		return api<Entry>("POST", "/api/entries", input);
	},

	update(id: number, input: EntryInput): Promise<Entry> {
		return api<Entry>("PATCH", `/api/entries/${id}`, input);
	},

	remove(id: number): Promise<{ ok: true }> {
		return api<{ ok: true }>("DELETE", `/api/entries/${id}`);
	},
};
