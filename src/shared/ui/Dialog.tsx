import { X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { Alert } from "./Alert";

interface DialogProps {
	title: string;
	subtitle?: string;
	confirmLabel?: string;
	confirmClassName?: "primary" | "danger";
	confirmDisabled?: boolean;
	className?: string;
	footer?: ReactNode;
	/** Ném lỗi để hiện thông báo và giữ hộp thoại mở. */
	onConfirm: () => Promise<void>;
	onClose: () => void;
	children: ReactNode;
}

export function Dialog({
	title,
	subtitle,
	confirmLabel = "Lưu",
	confirmClassName = "primary",
	confirmDisabled = false,
	className = "",
	footer,
	onConfirm,
	onClose,
	children,
}: DialogProps) {
	const titleId = useId();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		setBusy(true);
		try {
			await onConfirm();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Không lưu được.");
		} finally {
			setBusy(false);
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: bấm ra nền để đóng; hộp thoại bên trong mới là bề mặt tương tác có ngữ nghĩa.
		<div
			className="overlay"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className={`dialog ${className}`}>
				<form
					onSubmit={submit}
					role="dialog"
					aria-modal="true"
					aria-labelledby={titleId}
				>
					<div className="dialog-header">
						<div>
							<h3 id={titleId}>{title}</h3>
							{subtitle && <p>{subtitle}</p>}
						</div>
						<button
							type="button"
							className="icon-button"
							onClick={onClose}
							aria-label="Đóng"
						>
							<X size={16} />
						</button>
					</div>
					<div className="dialog-body">
						{error && <Alert tone="error">{error}</Alert>}
						{children}
					</div>
					{footer ? (
						<div className="dialog-footer">{footer}</div>
					) : (
						<div className="dialog-footer">
							<button
								type="button"
								className="button secondary"
								onClick={onClose}
							>
								Hủy
							</button>
							<button
								type="submit"
								className={`button ${confirmClassName}`}
								disabled={busy || confirmDisabled}
							>
								{busy ? "Đang lưu…" : confirmLabel}
							</button>
						</div>
					)}
				</form>
			</div>
		</div>
	);
}
