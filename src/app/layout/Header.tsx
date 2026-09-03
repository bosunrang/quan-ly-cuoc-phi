import { AtSign, LogOut, Menu } from "lucide-react";
import { initials } from "../../shared/lib/format";
import type { CurrentUser } from "../../types";

interface HeaderProps {
	title: string;
	subtitle: string;
	user: CurrentUser;
	onMenuClick: () => void;
	onLogout: () => void;
}

export function Header({
	title,
	subtitle,
	user,
	onMenuClick,
	onLogout,
}: HeaderProps) {
	return (
		<header className="topbar">
			<div className="topbar-title-wrap">
				<button
					className="mobile-menu"
					type="button"
					onClick={onMenuClick}
					aria-label="Mở điều hướng"
				>
					<Menu size={20} />
				</button>
				<div>
					<h1>{title}</h1>
					<p>{subtitle}</p>
				</div>
			</div>

			<div className="topbar-actions">
				<div className="profile-menu">
					<div className="avatar">{initials(user.fullName)}</div>
					<div className="profile-copy">
						<strong>{user.fullName}</strong>
						<span>
							<AtSign size={11} />
							{user.username}
						</span>
					</div>
					<button
						className="profile-logout"
						type="button"
						onClick={onLogout}
						title="Đăng xuất"
						aria-label="Đăng xuất"
					>
						<LogOut size={16} />
					</button>
				</div>
			</div>
		</header>
	);
}
