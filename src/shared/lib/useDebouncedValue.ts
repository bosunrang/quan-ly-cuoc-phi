import { useEffect, useState } from "react";

/** Giá trị chỉ cập nhật sau khi người dùng ngừng gõ `delayMs` mili giây. */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delayMs);
		return () => window.clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}
