import { useCallback, useEffect, useState } from "react";
import { authRepository } from "../domain/auth/auth.repository";
import { AuditPage } from "../features/audit/AuditPage";
import { InitialPasswordPage, LoginPage } from "../features/auth/LoginPage";
import { CarriersPage } from "../features/carriers/CarriersPage";
import { CustomersPage } from "../features/customers/CustomersPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { EmployeesPage } from "../features/employees/EmployeesPage";
import { EntriesPage } from "../features/entries/EntriesPage";
import { FuelPage } from "../features/fuel/FuelPage";
import { MisaPage } from "../features/misa/MisaPage";
import { FuelPriceReportPage } from "../features/reports/FuelPriceReportPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { useAppSettings } from "../features/settings/useAppSettings";
import { UsersPage } from "../features/users/UsersPage";
import { hasToken, setUnauthorizedHandler } from "../shared/api/client";
import { EmptyState, LoadingState } from "../shared/ui/Panel";
import type { PageId, Profile } from "../types";
import { Header } from "./layout/Header";
import { Sidebar } from "./layout/Sidebar";
import { pageConfig } from "./pageConfig";

type Status = "checking" | "guest" | "ready";

export function App() {
	const [status, setStatus] = useState<Status>("checking");
	const [profile, setProfile] = useState<Profile | null>(null);
	const [page, setPage] = useState<PageId | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const { settings, schemaVersion, saveSettings } = useAppSettings(
		status === "ready",
	);

	const accept = useCallback((next: Profile) => {
		setProfile(next);
		setPage(next.menu[0]?.key ?? null);
		setStatus("ready");
		setNotice(null);
	}, []);

	// Máy chủ báo hết phiên ở bất kỳ yêu cầu nào thì quay về màn đăng nhập.
	useEffect(() => {
		setUnauthorizedHandler(() => {
			setProfile(null);
			setStatus("guest");
			setNotice("Phiên làm việc đã kết thúc. Vui lòng đăng nhập lại.");
		});
	}, []);

	// Có token thì phục hồi phiên. Không có token, server phát triển có thể cấp
	// phiên Admin tự động; server bảo mật từ chối và app hiện màn đăng nhập.
	useEffect(() => {
		if (status !== "checking") return;
		const session = hasToken()
			? authRepository.me()
			: authRepository.devLogin();
		session.then(accept).catch(() => setStatus("guest"));
	}, [status, accept]);

	if (status === "checking") return <LoadingState />;

	if (status === "guest" || !profile) {
		return <LoginPage notice={notice} onSuccess={accept} />;
	}
	if (profile.user.mustChangePassword) {
		return <InitialPasswordPage profile={profile} onSuccess={accept} />;
	}

	const meta = page ? pageConfig[page] : null;
	const content = (() => {
		switch (page) {
			case "dashboard":
				return <DashboardPage />;
			case "entries":
				return <EntriesPage />;
			case "misa":
				return <MisaPage />;
			case "employees":
				return <EmployeesPage />;
			case "customers":
				return <CustomersPage />;
			case "carriers":
				return <CarriersPage />;
			case "fuel":
				return <FuelPage />;
			case "reports_employee":
				return <ReportsPage section="employee" />;
			case "reports_carrier":
				return <ReportsPage section="carrier" />;
			case "reports_fuel_price":
				return <FuelPriceReportPage />;
			case "users":
				return <UsersPage currentUser={profile.user} />;
			case "audit":
				return <AuditPage isAdmin={profile.user.isAdmin} />;
			case "settings":
				return (
					<SettingsPage
						settings={settings}
						schemaVersion={schemaVersion}
						onSave={saveSettings}
					/>
				);
			default:
				return (
					<EmptyState>
						Bạn chưa được cấp thẻ nào. Liên hệ quản trị viên.
					</EmptyState>
				);
		}
	})();

	return (
		<div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
			<Sidebar
				activePage={page}
				pages={profile.pages}
				collapsed={collapsed}
				settings={settings}
				onChange={setPage}
				onToggle={() => setCollapsed((current) => !current)}
			/>
			<div className="app-main">
				<Header
					title={meta?.title ?? "Quản lý cước phí"}
					subtitle={meta?.subtitle ?? ""}
					user={profile.user}
					onMenuClick={() => setCollapsed((current) => !current)}
					onLogout={async () => {
						await authRepository.logout();
						setProfile(null);
						setStatus("guest");
					}}
				/>
				<div className="page-content">
					<div className="page-stack">{content}</div>
				</div>
			</div>
		</div>
	);
}
