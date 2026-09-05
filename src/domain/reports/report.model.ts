export interface ReportEmployee {
	id: number;
	fullName: string;
}

export interface ReportData {
	employees: ReportEmployee[];
	years: string[];
}

export interface ReportExport {
	fileName: string;
	contentBase64: string;
}

export interface CarrierVarianceReport {
	employees: ReportEmployee[];
	items: Array<{
		id: number;
		carrier: string;
		customer: string;
		provinceCity: string;
		spec: string;
		actualFee: number;
		standardFee: number;
		difference: number;
		varianceNote: string;
	}>;
	summary: { entries: number; difference: number };
}
