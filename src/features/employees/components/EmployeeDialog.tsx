import { useState } from "react";
import type { EmployeeInput } from "../../../domain/employees/employee.model";
import { validateEmployee } from "../../../domain/employees/employee.model";
import type { ManagedUser } from "../../../domain/users/user.model";
import { Dialog } from "../../../shared/ui/Dialog";
import { Field, FieldGrid } from "../../../shared/ui/Field";

interface EmployeeDialogProps {
	initial: EmployeeInput;
	editingId: number | null;
	users: ManagedUser[];
	onSave: (input: EmployeeInput) => Promise<void>;
	onClose: () => void;
}

export function EmployeeDialog({
	initial,
	editingId,
	users,
	onSave,
	onClose,
}: EmployeeDialogProps) {
	const [form, setForm] = useState<EmployeeInput>(initial);
	const confirm = async () => {
		const problem = validateEmployee(form);
		if (problem) throw new Error(problem);
		await onSave(form);
	};
	return (
		<Dialog
			title={editingId ? "Cập nhật nhân viên" : "Thêm nhân viên"}
			subtitle="Thông tin dùng để phân công và tổng hợp cước phí."
			confirmLabel={editingId ? "Lưu thay đổi" : "Thêm nhân viên"}
			onConfirm={confirm}
			onClose={onClose}
		>
			<Field label="Họ tên">
				{(id) => (
					<input
						id={id}
						value={form.fullName}
						onChange={(event) =>
							setForm((current) => ({
								...current,
								fullName: event.target.value,
							}))
						}
						autoFocus
					/>
				)}
			</Field>
			<FieldGrid>
				<Field label="Địa chỉ">
					{(id) => (
						<input
							id={id}
							value={form.address}
							onChange={(event) =>
								setForm((current) => ({
									...current,
									address: event.target.value,
								}))
							}
							placeholder="Ví dụ: 12 Nguyễn Văn Trỗi, Phú Nhuận, TP. Hồ Chí Minh"
						/>
					)}
				</Field>
				<Field label="Tài khoản liên kết">
					{(id) => (
						<select
							id={id}
							value={form.userId ?? ""}
							onChange={(event) =>
								setForm((current) => ({
									...current,
									userId: event.target.value
										? Number(event.target.value)
										: null,
								}))
							}
						>
							<option value="">Chưa liên kết</option>
							{users.map((user) => (
								<option key={user.id} value={user.id}>
									{user.fullName} · {user.username}
								</option>
							))}
						</select>
					)}
				</Field>
			</FieldGrid>
			<Field label="Trạng thái">
				{(id) => (
					<select
						id={id}
						value={form.isActive ? "active" : "inactive"}
						onChange={(event) =>
							setForm((current) => ({
								...current,
								isActive: event.target.value === "active",
							}))
						}
					>
						<option value="active">Đang hoạt động</option>
						<option value="inactive">Tạm ngưng</option>
					</select>
				)}
			</Field>
		</Dialog>
	);
}
