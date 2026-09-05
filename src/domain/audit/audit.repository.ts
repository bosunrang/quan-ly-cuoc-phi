import { api } from "../../shared/api/client";
import type { AuditFilters, AuditResult } from "./audit.model";

export const auditRepository = {
	list(filters: AuditFilters = {}): Promise<AuditResult> {
		const query = new URLSearchParams();
		if (filters.q) query.set("q", filters.q);
		if (filters.from) query.set("from", filters.from);
		if (filters.to) query.set("to", filters.to);
		if (filters.limit) query.set("limit", String(filters.limit));
		if (filters.offset) query.set("offset", String(filters.offset));
		const suffix = query.size ? `?${query}` : "";
		return api<AuditResult>("GET", `/api/audit${suffix}`);
	},
	cleanup(beforeDate: string): Promise<{ deleted: number }> {
		return api("POST", "/api/audit/cleanup", { beforeDate });
	},
};
