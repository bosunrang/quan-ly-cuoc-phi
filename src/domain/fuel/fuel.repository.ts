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
	currentEmployee: { id: number; name: string } | null;
	locations: Array<{
		id: number;
		name: string;
		address: string;
		deliveryPoint: string;
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
		consumptionLiters: number;
		consumptionBaseKm: number;
		vehicleType: "motorcycle" | "truck" | "";
		fuelType: string;
		region: string;
		fuelPrice: number;
		totalFee: number;
		status: "active" | "voided";
		voidReason: string;
		finalizedAt: string | null;
		legs: Array<{ from: string; to: string; km: number }>;
		canEdit: boolean;
		canDelete: boolean;
	}>;
	recordsTotal: number;
	fuelTypes: string[];
	consumptionProfiles: Record<
		"motorcycle" | "truck",
		{ consumptionLiters: number; consumptionBaseKm: number }
	>;
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
	estimateRoute: (
		from: string,
		to: string,
	): Promise<{ km: number; source: string; estimated: boolean }> =>
		api(
			"POST",
			"/api/fuel/route-estimate",
			{ from, to },
			{ timeoutMs: 30_000 },
		),
	savePrice: (input: Omit<FuelPrice, "id">): Promise<FuelPrice> =>
		api("POST", "/api/fuel/prices", input),
	saveConsumption: (input: {
		vehicleType: "motorcycle" | "truck";
		consumptionLiters: number;
		consumptionBaseKm: number;
	}): Promise<FuelData["consumptionProfiles"]> =>
		api("PATCH", "/api/fuel/consumption", input),
	saveRecord: (
		input: Record<string, unknown>,
	): Promise<{ id: number; totalFee: number }> =>
		api("POST", "/api/fuel/records", input),
	updateRecord: (
		id: number,
		input: Record<string, unknown>,
	): Promise<{ id: number; totalFee: number }> =>
		api("PATCH", `/api/fuel/records/${id}`, input),
	deleteRecord: (id: number): Promise<{ ok: true }> =>
		api("DELETE", `/api/fuel/records/${id}`),
};
