import type { ReactNode } from "react";
import { useId } from "react";

interface FieldProps {
	label: string;
	hint?: string;
	error?: string;
	children: (id: string) => ReactNode;
}

/** Ô nhập kèm nhãn và ghi chú. Nhãn luôn gắn đúng với ô nhập qua id. */
export function Field({ label, hint, error, children }: FieldProps) {
	const id = useId();
	const required = label.endsWith(" *");
	const labelText = required ? label.slice(0, -2) : label;
	return (
		<div className={`field${error ? " has-error" : ""}`}>
			<label htmlFor={id}>
				{labelText}
				{required && <span className="field-required"> *</span>}
			</label>
			{children(id)}
			{error ? (
				<span className="field-error" role="alert">
					{error}
				</span>
			) : (
				hint && <span className="field-hint">{hint}</span>
			)}
		</div>
	);
}

export function FieldGrid({ children }: { children: ReactNode }) {
	return <div className="field-grid">{children}</div>;
}
