import type { InputHTMLAttributes } from "react";
import { useEffect, useState } from "react";
import { formatMoney } from "../lib/format";

interface MoneyInputProps
	extends Omit<
		InputHTMLAttributes<HTMLInputElement>,
		"type" | "value" | "defaultValue" | "onChange"
	> {
	value: number;
	onValueChange: (value: number) => void;
}

function displayFor(value: number): string {
	return value > 0 ? formatMoney(value) : "";
}

/** Ô tiền tệ không hiển thị số 0 mặc định và tự phân cách hàng nghìn khi nhập. */
export function MoneyInput({
	value,
	onValueChange,
	...props
}: MoneyInputProps) {
	const [display, setDisplay] = useState(() => displayFor(value));

	useEffect(() => {
		setDisplay(displayFor(value));
	}, [value]);

	return (
		<input
			{...props}
			type="text"
			inputMode="numeric"
			autoComplete="off"
			value={display}
			onChange={(event) => {
				const digits = event.target.value.replace(/\D/g, "");
				const next = digits ? Number(digits) : 0;
				setDisplay(digits ? formatMoney(next) : "");
				onValueChange(next);
			}}
		/>
	);
}
