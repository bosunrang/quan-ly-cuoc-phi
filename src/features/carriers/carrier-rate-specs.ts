import { normalizeText } from "../../shared/lib/text";

export const STANDARD_CARRIER_RATE_SPECS = [
	"Tất cả",
	"Thùng nhỏ",
	"Thùng trung",
	"Thùng lớn",
	"Hồ sơ",
] as const;

const STANDARD_SPEC_BY_KEY = new Map(
	STANDARD_CARRIER_RATE_SPECS.map((spec) => [normalizeText(spec), spec]),
);

/** Giữ cách viết thống nhất cho quy cách chuẩn, đồng thời chấp nhận tên tùy ý. */
export function canonicalCarrierRateSpec(value: unknown): string {
	const spec = String(value ?? "").trim();
	return STANDARD_SPEC_BY_KEY.get(normalizeText(spec)) ?? spec;
}
