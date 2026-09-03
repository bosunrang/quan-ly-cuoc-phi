import type { ReactNode } from "react";
import { useId } from "react";

interface FieldProps {
	label: string;
	hint?: string;
	children: (id: string) => ReactNode;
}

/** Ô nhập kèm nhãn và ghi chú. Nhãn luôn gắn đúng với ô nhập qua id. */
export function Field({ label, hint, children }: FieldProps) {
	const id = useId();
	return (
		<div className="field">
			<label htmlFor={id}>{label}</label>
			{children(id)}
			{hint && <span className="field-hint">{hint}</span>}
		</div>
	);
}

export function FieldGrid({ children }: { children: ReactNode }) {
	return <div className="field-grid">{children}</div>;
}
