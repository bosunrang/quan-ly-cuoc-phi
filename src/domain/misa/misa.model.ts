export type MisaImportStatus = "ready" | "duplicate" | "skipped";

export interface MisaImportRow {
	rowNumber: number;
	documentDate: string;
	documentCode: string;
	customerCode: string;
	customerName: string;
	address: string;
	productName: string;
	quantitySold: number | null;
	provinceCity: string;
	sourceKey: string;
	status: MisaImportStatus;
	reason: string;
}

export interface MisaParsedFile {
	fileName: string;
	rows: MisaImportRow[];
}

export interface MisaImportPreview extends MisaParsedFile {
	totalRows: number;
	readyCount: number;
	duplicateCount: number;
	skippedCount: number;
}

export interface MisaRecord {
	id: number;
	documentDate: string;
	documentCode: string;
	customerCode: string;
	customerName: string;
	address: string;
	productName: string;
	quantitySold: number;
	provinceCity: string;
	sourceFile: string;
	importedAt: string;
}

export interface MisaListResult {
	items: MisaRecord[];
	count: number;
	totalQuantity: number;
	customerCount: number;
	provinceCount: number;
	provinces: string[];
	page: number;
	pageCount: number;
	pageSize: number;
	lastImport: { fileName: string; importedAt: string } | null;
}

export interface MisaListFilters {
	search?: string;
	province?: string;
	page?: number;
	pageSize?: number;
}
