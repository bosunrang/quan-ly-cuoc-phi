import { api } from "../../shared/api/client";
import type { Customer } from "../customers/customer.model";
import type {
	Carrier,
	CarrierCustomerRate,
	CarrierCustomerRateInput,
	CarrierExcelCarrierInput,
	CarrierExcelExport,
	CarrierExcelPreview,
	CarrierExcelRateInput,
	CarrierInput,
	CarrierListResult,
} from "./carrier.model";

export const carrierRepository = {
	list: (): Promise<CarrierListResult> => api("GET", "/api/carriers"),
	listAssignedCustomers: (id: number): Promise<{ items: Customer[] }> =>
		api("GET", `/api/carriers/${id}/customers`),
	create: (input: CarrierInput): Promise<Carrier> =>
		api("POST", "/api/carriers", input),
	update: (id: number, input: CarrierInput): Promise<Carrier> =>
		api("PATCH", `/api/carriers/${id}`, input),
	remove: (id: number): Promise<{ ok: true }> =>
		api("DELETE", `/api/carriers/${id}`),
	assignCustomers: (id: number, customerIds: number[]): Promise<{ ok: true }> =>
		api("PATCH", `/api/carriers/${id}/customers`, { customerIds }),
	unassignCustomer: (id: number, customerId: number): Promise<{ ok: true }> =>
		api("DELETE", `/api/carriers/${id}/customers/${customerId}`),
	listCustomerRates: (
		carrierId: number,
		customerId: number,
	): Promise<{ items: CarrierCustomerRate[] }> =>
		api("GET", `/api/carriers/${carrierId}/customers/${customerId}/rates`),
	createCustomerRate: (
		carrierId: number,
		customerId: number,
		input: CarrierCustomerRateInput,
	): Promise<CarrierCustomerRate> =>
		api(
			"POST",
			`/api/carriers/${carrierId}/customers/${customerId}/rates`,
			input,
		),
	updateCustomerRate: (
		carrierId: number,
		customerId: number,
		rateId: number,
		input: CarrierCustomerRateInput,
	): Promise<CarrierCustomerRate> =>
		api(
			"PATCH",
			`/api/carriers/${carrierId}/customers/${customerId}/rates/${rateId}`,
			input,
		),
	removeCustomerRate: (
		carrierId: number,
		customerId: number,
		rateId: number,
	): Promise<{ ok: true }> =>
		api(
			"DELETE",
			`/api/carriers/${carrierId}/customers/${customerId}/rates/${rateId}`,
		),
	excelPreview: (
		carriers: CarrierExcelCarrierInput[],
		rates: CarrierExcelRateInput[],
	): Promise<CarrierExcelPreview> =>
		api(
			"POST",
			"/api/carriers/excel/preview",
			{ carriers, rates },
			{
				timeoutMs: 120_000,
			},
		),
	excelImport: (
		carriers: CarrierExcelCarrierInput[],
		rates: CarrierExcelRateInput[],
	): Promise<{
		carriersCreated: number;
		carriersUpdated: number;
		ratesCreated: number;
		ratesUpdated: number;
		skipped: number;
	}> =>
		api(
			"POST",
			"/api/carriers/excel/import",
			{ carriers, rates },
			{
				timeoutMs: 120_000,
			},
		),
	excelExport: (): Promise<CarrierExcelExport> =>
		api("GET", "/api/carriers/excel-export", undefined, {
			timeoutMs: 120_000,
		}),
};
