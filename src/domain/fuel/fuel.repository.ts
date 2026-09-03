import { api } from "../../shared/api/client";
export interface FuelPrice {
	id: number;
	effectiveDate: string;
	fuelType: string;
	region: "region1" | "region2";
	price: number;
	source: string;
}
export interface FuelData {
	prices: FuelPrice[];
	employees: Array<{ id: number; name: string }>;
	locations: Array<{
		id: number;
		name: string;
		address: string;
		type: "customer" | "carrier" | "employee";
	}>;
	distances: Array<{ id: number; from: string; to: string; km: number }>;
	records: Array<{
		id: number;
		entryDate: string;
		periodFrom: string;
		periodTo: string;
		employeeId: number | null;
		employeeName: string | null;
		distanceKm: number;
		fuelType: string;
		region: string;
		fuelPrice: number;
		totalFee: number;
	}>;
	recordsTotal: number;
	fuelTypes: string[];
	isAdmin: boolean;
}
export const fuelRepository = {
	list: (params?: {
		limit?: number;
		offset?: number;
		employeeId?: string;
	}): Promise<FuelData> => {
		const search = new URLSearchParams();
		if (params?.limit) search.set("limit", String(params.limit));
		if (params?.offset) search.set("offset", String(params.offset));
		if (params?.employeeId) search.set("employeeId", params.employeeId);
		return api("GET", `/api/fuel${search.size ? `?${search}` : ""}`);
	},
	online: (): Promise<{
		priceDate: string;
		source: string;
		items: Array<{ name: string; region1: number; region2: number }>;
	}> => api("GET", "/api/fuel/online"),
	savePrice: (input: Omit<FuelPrice, "id">): Promise<FuelPrice> =>
		api("POST", "/api/fuel/prices", input),
	saveRecord: (
		input: Record<string, unknown>,
	): Promise<{ id: number; totalFee: number }> =>
		api("POST", "/api/fuel/records", input),
};
