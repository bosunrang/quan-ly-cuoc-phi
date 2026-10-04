import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface PaginationProps {
	page: number;
	pageCount: number;
	onPageChange: (page: number) => void;
	/** Mô tả cho trình đọc màn hình, ví dụ "Phân trang khách hàng". */
	label: string;
	/** Thông tin thêm sau "Trang x/y", ví dụ tổng số dòng. */
	summary?: ReactNode;
	/** Khóa nút khi đang tải để không bấm dồn nhiều trang. */
	disabled?: boolean;
	/** footer: thanh dưới bảng; inline: gọn, nằm trong danh sách. */
	variant?: "footer" | "inline";
}

/** Thanh chuyển trang dùng chung. Không hiển thị khi chỉ có một trang. */
export function Pagination({
	page,
	pageCount,
	onPageChange,
	label,
	summary,
	disabled = false,
	variant = "footer",
}: PaginationProps) {
	if (pageCount <= 1) return null;
	return (
		<nav className={`pagination pagination-${variant}`} aria-label={label}>
			<button
				type="button"
				title="Trang trước"
				aria-label="Trang trước"
				disabled={disabled || page <= 1}
				onClick={() => onPageChange(Math.max(1, page - 1))}
			>
				<ChevronLeft size={16} />
			</button>
			<span>
				Trang {page}/{pageCount}
				{summary ? <> · {summary}</> : null}
			</span>
			<button
				type="button"
				title="Trang sau"
				aria-label="Trang sau"
				disabled={disabled || page >= pageCount}
				onClick={() => onPageChange(Math.min(pageCount, page + 1))}
			>
				<ChevronRight size={16} />
			</button>
		</nav>
	);
}
