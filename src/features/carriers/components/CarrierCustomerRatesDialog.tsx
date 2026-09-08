import { Building2, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import {
	type Carrier,
	type CarrierCustomerRate,
	type CarrierCustomerRateInput,
	emptyCarrierCustomerRateInput,
} from "../../../domain/carriers/carrier.model";
import { carrierRepository } from "../../../domain/carriers/carrier.repository";
import type { Customer } from "../../../domain/customers/customer.model";
import { formatMoney } from "../../../shared/lib/format";
import { Alert } from "../../../shared/ui/Alert";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { Dialog } from "../../../shared/ui/Dialog";
import { MoneyInput } from "../../../shared/ui/MoneyInput";

interface Props {
	carrier: Carrier;
	customer: Customer;
	onClose: () => void;
}

const toInput = (rate: CarrierCustomerRate): CarrierCustomerRateInput => ({
	spec: rate.isDefault ? "" : rate.spec,
	isDefault: rate.isDefault,
	transportFee: rate.transportFee,
	gateFee: rate.gateFee,
	note: rate.note,
});

export function CarrierCustomerRatesDialog({
	carrier,
	customer,
	onClose,
}: Props) {
	const transportFeeId = useId();
	const gateFeeId = useId();
	const [rates, setRates] = useState<CarrierCustomerRate[]>([]);
	const [form, setForm] = useState<CarrierCustomerRateInput>(
		emptyCarrierCustomerRateInput,
	);
	const [editing, setEditing] = useState<CarrierCustomerRate | null>(null);
	const [removing, setRemoving] = useState<CarrierCustomerRate | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			setLoading(true);
			setRates(
				(await carrierRepository.listCustomerRates(carrier.id, customer.id))
					.items,
			);
			setError(null);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không tải được bảng cước.",
			);
		} finally {
			setLoading(false);
		}
	}, [carrier.id, customer.id]);

	useEffect(() => {
		void load();
	}, [load]);

	const save = async () => {
		if (!form.isDefault && !form.spec.trim()) {
			throw new Error("Vui lòng nhập quy cách gửi hàng.");
		}
		if (editing) {
			await carrierRepository.updateCustomerRate(
				carrier.id,
				customer.id,
				editing.id,
				form,
			);
		} else {
			await carrierRepository.createCustomerRate(carrier.id, customer.id, form);
		}
		await load();
		setEditing(null);
		setForm(emptyCarrierCustomerRateInput());
	};

	const startEdit = (rate: CarrierCustomerRate) => {
		setEditing(rate);
		setForm(toInput(rate));
	};

	const remove = async () => {
		if (!removing) return;
		await carrierRepository.removeCustomerRate(
			carrier.id,
			customer.id,
			removing.id,
		);
		if (editing?.id === removing.id) {
			setEditing(null);
			setForm(emptyCarrierCustomerRateInput());
		}
		setRemoving(null);
		await load();
	};

	const total = form.transportFee + form.gateFee;
	return (
		<>
			<Dialog
				title="Bảng cước đơn vị"
				subtitle={`Thiết lập quy cách và chi phí khi gửi qua ${carrier.name}`}
				confirmLabel={editing ? "Cập nhật mức cước" : "Lưu quy cách"}
				onConfirm={save}
				onClose={onClose}
				className="carrier-rates-dialog"
			>
				<section className="carrier-rate-context">
					<span>
						<Truck size={18} />
					</span>
					<div>
						<strong>{carrier.name}</strong>
						<small>
							<Building2 size={13} /> {customer.customerName}
						</small>
					</div>
				</section>
				{error && <Alert tone="error">{error}</Alert>}
				<section
					className="carrier-rate-list"
					aria-label="Các mức cước đã thiết lập"
				>
					<header>
						<div>
							<strong>Bảng cước đã thiết lập</strong>
							<span>{rates.length} quy cách</span>
						</div>
						<Plus size={17} />
					</header>
					{loading ? (
						<p className="carrier-rate-empty">Đang tải bảng cước…</p>
					) : rates.length ? (
						<div className="table-scroll">
							<table>
								<thead>
									<tr>
										<th>Quy cách</th>
										<th className="rate-center">Cước vận chuyển</th>
										<th className="rate-center">Phí vào cổng</th>
										<th className="numeric">Tổng chuẩn</th>
										<th className="rate-center">Ghi chú</th>
										<th aria-label="Thao tác" />
									</tr>
								</thead>
								<tbody>
									{rates.map((rate) => (
										<tr key={rate.id}>
											<td>
												<strong>{rate.spec}</strong>
											</td>
											<td className="rate-center">
												{formatMoney(rate.transportFee)} đ
											</td>
											<td className="rate-center">
												{formatMoney(rate.gateFee)} đ
											</td>
											<td className="numeric strong-number">
												{formatMoney(rate.transportFee + rate.gateFee)} đ
											</td>
											<td className="rate-center">{rate.note || "—"}</td>
											<td>
												<div className="inline-actions">
													<button
														className="row-action"
														type="button"
														title="Sửa mức cước"
														aria-label={`Sửa mức cước ${rate.spec}`}
														onClick={() => startEdit(rate)}
													>
														<Pencil size={14} />
													</button>
													<button
														className="row-action is-danger"
														type="button"
														title="Xóa mức cước"
														aria-label={`Xóa mức cước ${rate.spec}`}
														onClick={() => setRemoving(rate)}
													>
														<Trash2 size={14} />
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<p className="carrier-rate-empty">
							Chưa có quy cách nào. Thêm dòng đầu tiên ở phần bên dưới.
						</p>
					)}
				</section>
				<section className="carrier-rate-form">
					<header>
						<strong>
							{editing ? `Chỉnh sửa: ${editing.spec}` : "Thêm quy cách"}
						</strong>
						{editing && (
							<button
								type="button"
								onClick={() => {
									setEditing(null);
									setForm(emptyCarrierCustomerRateInput());
								}}
							>
								Thêm mới
							</button>
						)}
					</header>
					<label className="carrier-rate-default">
						<input
							type="checkbox"
							checked={form.isDefault}
							onChange={(event) =>
								setForm((current) => ({
									...current,
									isDefault: event.target.checked,
								}))
							}
						/>
						<span>
							Áp dụng mặc định cho mọi quy cách chưa có giá riêng (Tất cả)
						</span>
					</label>
					<div className="carrier-rate-inputs">
						<label>
							Quy cách
							<input
								disabled={form.isDefault}
								value={form.isDefault ? "Tất cả" : form.spec}
								onChange={(event) =>
									setForm((current) => ({
										...current,
										spec: event.target.value,
									}))
								}
								placeholder="Ví dụ: 01 thùng nhỏ"
							/>
						</label>
						<label htmlFor={transportFeeId}>
							Cước vận chuyển
							<MoneyInput
								id={transportFeeId}
								value={form.transportFee}
								onValueChange={(transportFee) =>
									setForm((current) => ({
										...current,
										transportFee,
									}))
								}
							/>
						</label>
						<label htmlFor={gateFeeId}>
							Phí vào cổng
							<MoneyInput
								id={gateFeeId}
								value={form.gateFee}
								onValueChange={(gateFee) =>
									setForm((current) => ({
										...current,
										gateFee,
									}))
								}
							/>
						</label>
						<label>
							Tổng chuẩn
							<input value={`${formatMoney(total)} đ`} disabled />
						</label>
					</div>
					<label className="carrier-rate-note">
						Ghi chú
						<input
							value={form.note}
							onChange={(event) =>
								setForm((current) => ({ ...current, note: event.target.value }))
							}
							placeholder="Ví dụ: Ra nhận"
						/>
					</label>
				</section>
			</Dialog>
			{removing && (
				<ConfirmDialog
					title="Xóa mức cước"
					message={`Xóa mức cước “${removing.spec}” của ${customer.customerName}? Việc này không hoàn tác được.`}
					onConfirm={remove}
					onClose={() => setRemoving(null)}
				/>
			)}
		</>
	);
}
