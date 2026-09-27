import { Fuel, LayoutGrid, Receipt } from "lucide-react";
import { useState } from "react";
import type {
	GrantablePage,
	ManagedUser,
} from "../../../domain/users/user.model";
import { validateNewUser } from "../../../domain/users/user.model";
import { Alert } from "../../../shared/ui/Alert";
import { Dialog } from "../../../shared/ui/Dialog";
import { Field, FieldGrid } from "../../../shared/ui/Field";
import type { PageId } from "../../../types";

interface UserDialogProps {
	/** null = tạo mới. */
	user: ManagedUser | null;
	grantable: GrantablePage[];
	onSave: (input: {
		username: string;
		fullName: string;
		password: string;
		isAdmin: boolean;
		pages: PageId[];
	}) => Promise<void>;
	onClose: () => void;
}

export function UserDialog({
	user,
	grantable,
	onSave,
	onClose,
}: UserDialogProps) {
	const isEdit = Boolean(user);
	const [username, setUsername] = useState(user?.username ?? "");
	const [fullName, setFullName] = useState(user?.fullName ?? "");
	const [password, setPassword] = useState("");
	const [isAdmin, setIsAdmin] = useState(user?.isAdmin ?? false);
	const [pages, setPages] = useState<PageId[]>(user?.pages ?? []);
	const pageIcons: Partial<Record<PageId, typeof LayoutGrid>> = {
		dashboard: LayoutGrid,
		entries: Receipt,
		fuel: Fuel,
	};

	const toggle = (key: PageId) =>
		setPages((current) =>
			current.includes(key)
				? current.filter((item) => item !== key)
				: [...current, key],
		);

	const confirm = async () => {
		if (!isEdit) {
			const problem = validateNewUser({
				username,
				fullName,
				password,
				isAdmin,
				pages,
			});
			if (problem) throw new Error(problem);
		} else if (!fullName.trim()) {
			throw new Error("Vui lòng nhập họ tên.");
		}
		await onSave({ username, fullName, password, isAdmin, pages });
	};

	return (
		<Dialog
			className="user-dialog"
			title={isEdit ? `Sửa ${user?.fullName}` : "Thêm người dùng"}
			subtitle="Tick những thẻ người này được phép mở"
			confirmLabel={isEdit ? "Lưu thay đổi" : "Tạo tài khoản"}
			onConfirm={confirm}
			onClose={onClose}
		>
			<FieldGrid>
				<Field label="Họ tên">
					{(id) => (
						<input
							id={id}
							type="text"
							value={fullName}
							onChange={(event) => setFullName(event.target.value)}
						/>
					)}
				</Field>
				<Field
					label="Tên đăng nhập"
					hint={
						isEdit
							? "Không đổi được sau khi tạo"
							: "Chữ thường, số, dấu chấm; 3–32 ký tự"
					}
				>
					{(id) => (
						<input
							id={id}
							type="text"
							value={username}
							disabled={isEdit}
							onChange={(event) => setUsername(event.target.value)}
						/>
					)}
				</Field>
			</FieldGrid>

			{!isEdit && (
				<Field label="Mật khẩu" hint="Tối thiểu 8 ký tự">
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
			)}

			{!isEdit && (
				<label className="user-admin-toggle">
					<input
						type="checkbox"
						checked={isAdmin}
						onChange={(event) => setIsAdmin(event.target.checked)}
					/>
					<span>
						<strong>Tài khoản toàn quyền</strong>
						<small>
							Dành cho sếp hoặc quản trị viên: xem và quản lý toàn bộ dữ liệu.
						</small>
					</span>
				</label>
			)}

			{isAdmin ? (
				<Alert tone="info">
					Tài khoản này có toàn bộ quyền quản trị; không cần chọn từng thẻ.
				</Alert>
			) : (
				<div className="field user-access-field">
					{/* biome-ignore lint/a11y/noLabelWithoutControl: nhãn cho cả nhóm ô tick bên dưới */}
					<label>Thẻ được truy cập</label>
					<span className="user-access-hint">
						Chọn các màn hình nhân viên được phép sử dụng.
					</span>
					<div className="page-picker user-page-picker">
						{grantable.map((page) => {
							const Icon = pageIcons[page.key];
							const isSelected = pages.includes(page.key);
							return (
								<label
									className={`page-option user-page-option${isSelected ? " is-selected" : ""}`}
									key={page.key}
								>
									<input
										type="checkbox"
										checked={isSelected}
										onChange={() => toggle(page.key)}
									/>
									<span className="user-page-icon">
										{Icon && <Icon size={18} />}
									</span>
									<div>
										<strong>{page.label}</strong>
										<span>{page.description}</span>
									</div>
								</label>
							);
						})}
					</div>
				</div>
			)}
		</Dialog>
	);
}
