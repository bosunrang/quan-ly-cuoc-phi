import { api } from "../../shared/api/client";
import type {
	MisaImportPreview,
	MisaListFilters,
	MisaListResult,
	MisaParsedFile,
} from "./misa.model";

export const misaRepository = {
	list(filters: MisaListFilters = {}): Promise<MisaListResult> {
		const query = new URLSearchParams();
		if (filters.search) query.set("search", filters.search);
		if (filters.province) query.set("province", filters.province);
		if (filters.page) query.set("page", String(filters.page));
		if (filters.pageSize) query.set("pageSize", String(filters.pageSize));
		return api<MisaListResult>("GET", `/api/misa?${query}`);
	},

	preview(parsed: MisaParsedFile): Promise<MisaImportPreview> {
		return api<MisaImportPreview>("POST", "/api/misa/preview", parsed, {
			timeoutMs: 120_000,
		});
	},

	import(preview: MisaImportPreview): Promise<{
		inserted: number;
		duplicates: number;
	}> {
		return api(
			"POST",
			"/api/misa/import",
			{
				fileName: preview.fileName,
				rows: preview.rows.filter((row) => row.status === "ready"),
			},
			{ timeoutMs: 120_000 },
		);
	},
};
