export interface ReportEmployee {
	id: number;
	fullName: string;
}

export interface ReportData {
	employees: ReportEmployee[];
	/** Admin được tổng hợp toàn bộ; máy trạm chỉ có hồ sơ nhân viên của mình. */
	canReportAll: boolean;
}

export interface ReportExport {
	fileName: string;
	contentBase64: string;
}

export interface PrintableReport {
	type: "daily";
	sheets: Array<{
		name: string;
		columnWidths: number[];
		rows: Array<{
			number: number;
			cells: Array<{
				address: string;
				value: string;
				rowSpan: number;
				colSpan: number;
				align: string;
				bold: boolean;
				italic: boolean;
				color: string;
				border: boolean;
			}>;
		}>;
	}>;
}

export interface CarrierVarianceReport {
	employees: ReportEmployee[];
	items: Array<{
		id: number;
		entryDate: string;
		employeeName: string;
		carrier: string;
		customer: string;
		provinceCity: string;
		spec: string;
		actualFee: number;
		standardFee: number;
		difference: number;
		varianceNote: string;
	}>;
	/** Tính trên toàn bộ kết quả lọc, không chỉ trang đang xem. */
	summary: {
		entries: number;
		difference: number;
		overEntries: number;
		overAmount: number;
		underEntries: number;
		underAmount: number;
	};
	page: number;
	pageCount: number;
	pageSize: number;
}

export interface FuelHistoryReport {
	employees: ReportEmployee[];
	recordsTotal: number;
	summary: { distanceKm: number; totalFee: number };
	items: Array<{
		id: number;
		periodFrom: string;
		periodTo: string;
		employeeName: string;
		distanceKm: number;
		consumptionLiters: number;
		consumptionBaseKm: number;
		vehicleType: "motorcycle" | "truck" | "";
		fuelType: string;
		region: "region1" | "region2";
		fuelPrice: number;
		totalFee: number;
		status: "active" | "voided";
		voidReason: string;
		legs: Array<{ sequenceNo: number; from: string; to: string; km: number }>;
	}>;
}
