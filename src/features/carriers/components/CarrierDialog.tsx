import { useState } from "react";
import type { CarrierInput } from "../../../domain/carriers/carrier.model";
import { validateCarrier } from "../../../domain/carriers/carrier.model";
import { Dialog } from "../../../shared/ui/Dialog";
import { Field, FieldGrid } from "../../../shared/ui/Field";

interface CarrierDialogProps {
	initial: CarrierInput;
	editingId: number | null;
	deliveryPointOptions: string[];
	onSave: (input: CarrierInput) => Promise<void>;
	onClose: () => void;
}

export function CarrierDialog({
	initial,
	editingId,
	deliveryPointOptions,
	onSave,
	onClose,
}: CarrierDialogProps) {
	const [form, setForm] = useState(initial);
	const setText =
		(key: keyof CarrierInput) => (event: { target: { value: string } }) =>
			setForm((current) => ({ ...current, [key]: event.target.value }));
	const confirm = async () => {
		const error = validateCarrier(form);
		if (error) throw new Error(error);
		await onSave(form);
	};
	return (
		<Dialog
			title={editingId ? "Cập nhật nhà xe" : "Thêm nhà xe"}
			subtitle="Thông tin này được dùng khi gán khách hàng và lập bảng cước."
			confirmLabel={editingId ? "Lưu thay đổi" : "Thêm nhà xe"}
			onConfirm={confirm}
			onClose={onClose}
		>
			<Field label="Tên nhà xe">
				{(id) => (
					<input
						id={id}
						value={form.name}
						onChange={setText("name")}
						placeholder="Ví dụ: Chành xe Minh Phát"
						autoFocus
					/>
				)}
			</Field>
			<FieldGrid>
				<Field label="Người liên hệ">
					{(id) => (
						<input
							id={id}
							value={form.contact}
							onChange={setText("contact")}
							placeholder="Họ và tên"
						/>
					)}
				</Field>
				<Field label="Số điện thoại">
					{(id) => (
						<input
							id={id}
							value={form.phone}
							onChange={setText("phone")}
							placeholder="Số điện thoại liên hệ"
						/>
					)}
				</Field>
			</FieldGrid>
			<Field label="Địa chỉ nhà xe">
				{(id) => (
					<textarea
						id={id}
						value={form.address}
						onChange={setText("address")}
						placeholder="Địa chỉ nhận hàng hoặc văn phòng"
					/>
				)}
			</Field>
			<Field label="Điểm giao / Bến xe">
				{(id) => (
					<>
						<input
							id={id}
							list="carrier-delivery-point-options"
							value={form.deliveryPoint}
							onChange={setText("deliveryPoint")}
							placeholder="Ví dụ: Bến xe Miền Tây, 395 Kinh Dương Vương"
						/>
						<datalist id="carrier-delivery-point-options">
							{deliveryPointOptions.map((value) => (
								<option key={value} value={value} />
							))}
						</datalist>
					</>
				)}
			</Field>
			<Field label="Giờ xe chạy / nhận hàng">
				{(id) => (
					<input
						id={id}
						value={form.schedule}
						onChange={setText("schedule")}
						placeholder="Ví dụ: Nhận hàng 10h–13h"
					/>
				)}
			</Field>
			<Field label="Ghi chú">
				{(id) => (
					<textarea
						id={id}
						value={form.note}
						onChange={setText("note")}
						placeholder="Thông tin cần lưu ý"
					/>
				)}
			</Field>
			<Field label="Trạng thái">
				{(id) => (
					<select
						id={id}
						value={form.isActive ? "active" : "paused"}
						onChange={(event) =>
							setForm((current) => ({
								...current,
								isActive: event.target.value === "active",
							}))
						}
					>
						<option value="active">Hoạt động</option>
						<option value="paused">Tạm dừng</option>
					</select>
				)}
			</Field>
		</Dialog>
	);
}
