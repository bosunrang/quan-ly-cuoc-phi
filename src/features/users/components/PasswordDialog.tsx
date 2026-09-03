import { useState } from "react";
import type { ManagedUser } from "../../../domain/users/user.model";
import { validatePassword } from "../../../domain/users/user.model";
import { Dialog } from "../../../shared/ui/Dialog";
import { Field } from "../../../shared/ui/Field";

interface PasswordDialogProps {
	user: ManagedUser;
	onSave: (password: string) => Promise<void>;
	onClose: () => void;
}

export function PasswordDialog({ user, onSave, onClose }: PasswordDialogProps) {
	const [password, setPassword] = useState("");

	return (
		<Dialog
			title="Đặt lại mật khẩu"
			subtitle={`${user.fullName} sẽ bị đăng xuất khỏi mọi máy`}
			confirmLabel="Đặt lại"
			onConfirm={async () => {
				const problem = validatePassword(password);
				if (problem) throw new Error(problem);
				await onSave(password);
			}}
			onClose={onClose}
		>
			<Field label="Mật khẩu mới" hint="Tối thiểu 8 ký tự">
				{(id) => (
					<input
						id={id}
						type="password"
						autoComplete="new-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				)}
			</Field>
		</Dialog>
	);
}
