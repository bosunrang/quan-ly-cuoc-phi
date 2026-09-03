import type { ReactNode } from "react";

/**
 * Nhãn trạng thái dùng chung. Đúng năm ngữ nghĩa như các app nội bộ khác:
 * success (hoàn tất/đang hoạt động), warning (chờ/chưa đủ), info (đã xử lý),
 * neutral (tạm dừng/chưa thiết lập), danger (lỗi/không hợp lệ).
 *
 * Feature không tự đặt màu hay viền cho nhãn trạng thái.
 */
export type StatusTone = "success" | "warning" | "info" | "neutral" | "danger";

interface StatusPillProps {
	tone: StatusTone;
	children: ReactNode;
	icon?: ReactNode;
	className?: string;
	title?: string;
}

export function StatusPill({
	tone,
	children,
	icon,
	className = "",
	title,
}: StatusPillProps) {
	return (
		<span
			className={`status-pill status-pill-${tone} ${className}`.trim()}
			title={title}
		>
			{icon}
			<span>{children}</span>
		</span>
	);
}
