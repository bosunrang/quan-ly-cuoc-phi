import { normalizeText } from "../../shared/lib/text";
import type { FuelData } from "./fuel.repository";

type Location = FuelData["locations"][number];
type SearchItem = {
	item: Location;
	name: string;
	addresses: string[];
	combined: string;
};
const indexes = new WeakMap<FuelData["locations"], SearchItem[]>();
const RESULT_LIMIT = 20;

// Dùng chung chỉ mục đã chuẩn hóa cho mọi ô, chỉ dựng lại khi tải danh mục mới.
function searchIndex(locations: FuelData["locations"]): SearchItem[] {
	let index = indexes.get(locations);
	if (!index) {
		index = locations.map((item) => ({
			item,
			name: normalizeText(item.name),
			addresses: [
				normalizeText(item.address),
				normalizeText(item.deliveryPoint),
			],
			combined: normalizeText(
				`${item.name} ${item.address} ${item.deliveryPoint}`,
			),
		}));
		indexes.set(locations, index);
	}
	return index;
}

function relevance(entry: SearchItem, query: string, words: string[]) {
	if (entry.name === query) return [0, 0, entry.name.length];
	if (entry.name.startsWith(query)) return [1, 0, entry.name.length];
	const namePosition = entry.name.indexOf(query);
	if (namePosition >= 0) return [2, namePosition, entry.name.length];
	if (words.every((word) => entry.name.includes(word)))
		return [3, 0, entry.name.length];
	if (entry.addresses.some((address) => address === query)) return [4, 0, 0];
	if (entry.addresses.some((address) => address.startsWith(query)))
		return [5, 0, 0];
	const positions = entry.addresses
		.map((address) => address.indexOf(query))
		.filter((position) => position >= 0);
	if (positions.length) return [6, Math.min(...positions), 0];
	if (words.every((word) => entry.combined.includes(word))) return [7, 0, 0];
	return null;
}

/** Lấy 20 điểm sát từ khóa nhất; ưu tiên tên trước địa chỉ và giữ thứ tự khi bằng điểm. */
export function searchFuelLocations(
	locations: FuelData["locations"],
	value: string,
): Location[] {
	const query = normalizeText(value);
	const index = searchIndex(locations);
	if (!query) return index.slice(0, RESULT_LIMIT).map((entry) => entry.item);
	const words = query.split(" ");
	return index
		.flatMap((entry, order) => {
			const score = relevance(entry, query, words);
			return score ? [{ item: entry.item, score, order }] : [];
		})
		.sort(
			(left, right) =>
				left.score[0] - right.score[0] ||
				left.score[1] - right.score[1] ||
				left.score[2] - right.score[2] ||
				left.order - right.order,
		)
		.slice(0, RESULT_LIMIT)
		.map((entry) => entry.item);
}

/** Gõ trọn tên chỉ tự điền địa chỉ khi tên đó xác định duy nhất một điểm. */
export function exactFuelLocations(
	locations: FuelData["locations"],
	value: string,
): Location[] {
	const query = normalizeText(value);
	return searchIndex(locations)
		.filter((entry) => entry.name === query)
		.map((entry) => entry.item);
}
