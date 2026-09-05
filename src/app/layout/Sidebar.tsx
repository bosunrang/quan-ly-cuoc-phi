import { ChevronLeft, ShieldCheck } from "lucide-react";
import { version as appVersion } from "../../../package.json";
import type { AppSettings } from "../../domain/settings/settings.model";
import type { PageId } from "../../types";
import { visibleGroups } from "../navigation";

interface SidebarProps {
	activePage: PageId | null;
	pages: PageId[];
	collapsed: boolean;
	settings: AppSettings;
	onChange: (page: PageId) => void;
	onToggle: () => void;
}

export function Sidebar({
	activePage,
	pages,
	collapsed,
	settings,
	onChange,
	onToggle,
}: SidebarProps) {
	const groups = visibleGroups(pages);

	return (
		<aside
			className={`sidebar ${collapsed ? "is-collapsed" : ""}`}
			aria-label="Điều hướng ứng dụng"
		>
			<div className="brand">
				<div className="brand-mark">
					{settings.logoDataUrl ? (
						<img src={settings.logoDataUrl} alt="Logo phần mềm" />
					) : (
						<span>CP</span>
					)}
				</div>
				{!collapsed && (
					<div className="brand-copy">
						<strong>{settings.displayName || "Cước phí"}</strong>
						<span>{settings.tagline || "Quản lý giao hàng"}</span>
					</div>
				)}
				<button
					className="sidebar-toggle"
					type="button"
					onClick={onToggle}
					aria-label={
						collapsed ? "Mở thanh điều hướng" : "Thu gọn thanh điều hướng"
					}
				>
					<ChevronLeft size={17} />
				</button>
			</div>

			<div className="sync-status">
				<span className="sync-dot" />
				{!collapsed && <span>Dữ liệu dùng chung</span>}
			</div>

			<nav className="nav-groups" aria-label="Điều hướng chính">
				{groups.map((group) => (
					<div className="nav-group" key={group.label}>
						{!collapsed && <div className="nav-group-label">{group.label}</div>}
						<div className="nav-group-items">
							{group.items.map((item) => {
								const Icon = item.icon;
								const active = item.id === activePage;
								return (
									<button
										type="button"
										className={`nav-item ${active ? "is-active" : ""}`}
										key={item.id}
										onClick={() => onChange(item.id)}
										title={collapsed ? item.label : undefined}
										aria-current={active ? "page" : undefined}
									>
										<Icon size={18} strokeWidth={1.9} />
										{!collapsed && <span>{item.label}</span>}
									</button>
								);
							})}
						</div>
					</div>
				))}
			</nav>

			<div className="sidebar-footer">
				<div className="security-mark">
					<ShieldCheck size={18} />
				</div>
				{!collapsed && (
					<div>
						<strong>Phiên bản nội bộ</strong>
						<span>Khung giao diện V{appVersion}</span>
					</div>
				)}
			</div>
		</aside>
	);
}
