import { Dialog } from "./Dialog";

interface ConfirmDialogProps {
	title: string;
	message: string;
	confirmLabel?: string;
	onConfirm: () => Promise<void>;
	onClose: () => void;
}

/** Hỏi lại trước khi làm việc không hoàn tác được. */
export function ConfirmDialog({
	title,
	message,
	confirmLabel = "Xóa",
	onConfirm,
	onClose,
}: ConfirmDialogProps) {
	return (
		<Dialog
			title={title}
			confirmLabel={confirmLabel}
			onConfirm={onConfirm}
			onClose={onClose}
		>
			<p className="confirm-message">{message}</p>
		</Dialog>
	);
}
