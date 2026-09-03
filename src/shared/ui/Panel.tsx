import type { ReactNode } from "react";

interface PanelProps {
	title: string;
	subtitle?: string;
	actions?: ReactNode;
	children: ReactNode;
}

/** Khung nội dung chuẩn: tiêu đề, mô tả, nút thao tác bên phải. */
export function Panel({ title, subtitle, actions, children }: PanelProps) {
	return (
		<section className="panel data-panel">
			<div className="panel-header">
				<div>
					<h3>{title}</h3>
					{subtitle && <p>{subtitle}</p>}
				</div>
				{actions && <div className="inline-actions">{actions}</div>}
			</div>
			{children}
		</section>
	);
}

/** Tiêu đề panel dùng khi phần thân được bố cục trực tiếp tại trang. */
export function PanelHeader({
	title,
	description,
	actions,
	icon,
}: {
	title: string;
	description?: string;
	actions?: ReactNode;
	icon?: ReactNode;
}) {
	return (
		<div className="panel-header">
			<div className={icon ? "panel-heading-with-icon" : undefined}>
				{icon && <span className="panel-header-icon">{icon}</span>}
				<div>
					<h3>{title}</h3>
					{description && <p>{description}</p>}
				</div>
			</div>
			{actions && <div className="inline-actions">{actions}</div>}
		</div>
	);
}

export function EmptyState({ children }: { children: ReactNode }) {
	return <div className="empty-state">{children}</div>;
}

export function LoadingState() {
	return <div className="empty-state">Đang tải…</div>;
}
