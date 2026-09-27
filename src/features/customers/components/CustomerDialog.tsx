import { useState } from "react";
import type { CustomerInput } from "../../../domain/customers/customer.model";
import { validateCustomer } from "../../../domain/customers/customer.model";
import { Dialog } from "../../../shared/ui/Dialog";
import { Field, FieldGrid } from "../../../shared/ui/Field";

interface CustomerDialogProps {
	initial: CustomerInput;
	editingId: number | null;
	onSave: (input: CustomerInput) => Promise<void>;
	onClose: () => void;
}

export function CustomerDialog({
	initial,
	editingId,
	onSave,
	onClose,
}: CustomerDialogProps) {
	const [form, setForm] = useState<CustomerInput>(initial);
	const setText =
		(key: keyof CustomerInput) => (event: { target: { value: string } }) =>
			setForm((current) => ({ ...current, [key]: event.target.value }));
	const confirm = async () => {
		const problem = validateCustomer(form);
		if (problem) throw new Error(problem);
		await onSave(form);
	};
	return (
		<Dialog
			title={editingId ? "Cập nhật khách hàng" : "Thêm khách hàng"}
			subtitle={
				editingId
					? `Khách hàng #${editingId}`
					: "Lưu thông tin mặc định cho lần giao hàng tiếp theo"
			}
			confirmLabel={editingId ? "Lưu thay đổi" : "Thêm khách hàng"}
			onConfirm={confirm}
			onClose={onClose}
		>
			<Field label="Tên khách hàng">
				{(id) => (
					<input
						id={id}
						type="text"
						value={form.customerName}
						onChange={setText("customerName")}
						placeholder="Ví dụ: Công ty TNHH ABC"
						autoFocus
					/>
				)}
			</Field>
			<FieldGrid>
				<Field label="Mã khách hàng">
					{(id) => (
						<input
							id={id}
							type="text"
							value={form.customerCode}
							onChange={setText("customerCode")}
							placeholder="Ví dụ: KH-001"
						/>
					)}
				</Field>
				<Field label="Nhà xe">
					{(id) => (
						<input
							id={id}
							type="text"
							value={form.carrier}
							onChange={setText("carrier")}
							placeholder="Ví dụ: Minh Phát"
						/>
					)}
				</Field>
				<Field label="Người nhận">
					{(id) => (
						<input
							id={id}
							type="text"
							value={form.recipient}
							onChange={setText("recipient")}
							placeholder="Họ và tên người nhận"
						/>
					)}
				</Field>
			</FieldGrid>
			<Field label="Địa chỉ giao hàng">
				{(id) => (
					<textarea
						id={id}
						value={form.address}
						onChange={setText("address")}
						placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
					/>
				)}
			</Field>
		</Dialog>
	);
}
