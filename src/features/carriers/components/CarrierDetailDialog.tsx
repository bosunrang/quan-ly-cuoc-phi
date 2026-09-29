import {
	Clock3,
	MapPin,
	Pencil,
	Phone,
	Trash2,
	Truck,
	UserRound,
} from "lucide-react";
import type { Carrier } from "../../../domain/carriers/carrier.model";
import { Dialog } from "../../../shared/ui/Dialog";
import { StatusPill } from "../../../shared/ui/StatusPill";

interface Props {
	carrier: Carrier;
	onClose: () => void;
	onEdit: () => void;
	onDelete: () => void;
}

export function CarrierDetailDialog({
	carrier,
	onClose,
	onEdit,
	onDelete,
}: Props) {
	return (
		<Dialog
			title="Chi tiết nhà xe"
			subtitle="Thông tin dùng khi gửi hàng và thiết lập bảng cước"
			confirmLabel="Đóng"
			onConfirm={async () => onClose()}
			onClose={onClose}
			className="carrier-detail-dialog"
			footer={
				<>
					<button type="button" className="button danger" onClick={onDelete}>
						<Trash2 size={15} /> Xóa nhà xe
					</button>
					<button type="button" className="button primary" onClick={onEdit}>
						<Pencil size={15} /> Chỉnh sửa hồ sơ
					</button>
				</>
			}
		>
			<section className="carrier-detail-hero">
				<span className="carrier-detail-icon">
					<Truck size={23} />
				</span>
				<div>
					<strong>{carrier.name}</strong>
					<span>{carrier.isActive ? "Đang hợp tác" : "Đang tạm ngưng"}</span>
				</div>
				<StatusPill tone={carrier.isActive ? "success" : "neutral"}>
					{carrier.isActive ? "Hoạt động" : "Tạm dừng"}
				</StatusPill>
			</section>
			<section className="carrier-detail-grid">
				<div>
					<UserRound size={16} />
					<span>Người liên hệ</span>
					<strong>{carrier.contact || "Chưa cập nhật"}</strong>
				</div>
				<div>
					<Phone size={16} />
					<span>Điện thoại</span>
					<strong>{carrier.phone || "Chưa cập nhật"}</strong>
				</div>
				<div>
					<Clock3 size={16} />
					<span>Giờ xe chạy</span>
					<strong>{carrier.schedule || "Chưa cập nhật"}</strong>
				</div>
				<div>
					<MapPin size={16} />
					<span>Địa chỉ</span>
					<strong>{carrier.address || "Chưa cập nhật"}</strong>
				</div>
				<div>
					<MapPin size={16} />
					<span>Điểm giao / Bến xe</span>
					<strong>
						{carrier.deliveryPoint || "Giao trực tiếp tại nhà xe"}
					</strong>
				</div>
			</section>
			<section className="carrier-detail-note">
				<span>Ghi chú</span>
				<p>{carrier.note || "Chưa có ghi chú"}</p>
			</section>
		</Dialog>
	);
}
