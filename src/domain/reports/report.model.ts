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
	items: Array<{
		id: number;
		carrier: string;
		customer: string;
		spec: string;
		actualFee: number;
		standardFee: number;
		difference: number;
		varianceNote: string;
	}>;
	summary: { entries: number; absoluteDifference: number; difference: number };
}
