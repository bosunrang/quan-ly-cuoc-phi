import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { authRepository } from "../domain/auth/auth.repository";
import { InitialPasswordPage, LoginPage } from "../features/auth/LoginPage";
import { useAppSettings } from "../features/settings/useAppSettings";
import { hasToken, setUnauthorizedHandler } from "../shared/api/client";
import { ErrorBoundary } from "../shared/ui/ErrorBoundary";
import { EmptyState, LoadingState } from "../shared/ui/Panel";
import type { PageId, Profile } from "../types";
import { ConnectionBanner } from "./layout/ConnectionBanner";
import { Header } from "./layout/Header";
import { Sidebar } from "./layout/Sidebar";
import { pageConfig } from "./pageConfig";

// Mỗi màn hình là một chunk riêng: lần mở đầu chỉ tải màn đăng nhập, còn bộ
// đọc Excel và các trang nặng chỉ tải khi người dùng mở đúng thẻ đó.
const AuditPage = lazy(() =>
	import("../features/audit/AuditPage").then((m) => ({ default: m.AuditPage })),
);
const CarriersPage = lazy(() =>
	import("../features/carriers/CarriersPage").then((m) => ({
		default: m.CarriersPage,
	})),
);
const CustomersPage = lazy(() =>
	import("../features/customers/CustomersPage").then((m) => ({
		default: m.CustomersPage,
	})),
);
const DashboardPage = lazy(() =>
	import("../features/dashboard/DashboardPage").then((m) => ({
		default: m.DashboardPage,
	})),
);
const EmployeesPage = lazy(() =>
	import("../features/employees/EmployeesPage").then((m) => ({
		default: m.EmployeesPage,
	})),
);
const EntriesPage = lazy(() =>
	import("../features/entries/EntriesPage").then((m) => ({
		default: m.EntriesPage,
	})),
);
const FuelPage = lazy(() =>
	import("../features/fuel/FuelPage").then((m) => ({ default: m.FuelPage })),
);
const MisaPage = lazy(() =>
	import("../features/misa/MisaPage").then((m) => ({ default: m.MisaPage })),
);
const FuelPriceReportPage = lazy(() =>
	import("../features/reports/FuelPriceReportPage").then((m) => ({
		default: m.FuelPriceReportPage,
	})),
);
const ReportsPage = lazy(() =>
	import("../features/reports/ReportsPage").then((m) => ({
		default: m.ReportsPage,
	})),
);
const SettingsPage = lazy(() =>
	import("../features/settings/SettingsPage").then((m) => ({
		default: m.SettingsPage,
	})),
);
const UsersPage = lazy(() =>
	import("../features/users/UsersPage").then((m) => ({ default: m.UsersPage })),
);

type Status = "checking" | "guest" | "ready";

export function App() {
	const [status, setStatus] = useState<Status>("checking");
	const [profile, setProfile] = useState<Profile | null>(null);
	const [page, setPage] = useState<PageId | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
	const changePage = (nextPage: PageId) => {
		setPage(nextPage);
		// Chọn thẻ xong thì trả lại toàn bộ màn hình cho nội dung trên điện thoại.
		setMobileNavOpen(false);
	};
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
		<div
			className={`app-shell ${collapsed ? "sidebar-collapsed" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}
		>
			<Sidebar
				activePage={page}
				pages={profile.pages}
				collapsed={collapsed}
				settings={settings}
				onChange={changePage}
				onToggle={() => setCollapsed((current) => !current)}
			/>
			{mobileNavOpen && (
				<button
					type="button"
					className="mobile-nav-backdrop"
					onClick={() => setMobileNavOpen(false)}
					aria-label="Đóng điều hướng"
				/>
			)}
			<div className="app-main">
				<Header
					title={meta?.title ?? "Quản lý cước phí"}
					subtitle={meta?.subtitle ?? ""}
					user={profile.user}
					onMenuClick={() => setMobileNavOpen((current) => !current)}
					menuOpen={mobileNavOpen}
					onLogout={async () => {
						await authRepository.logout();
						setProfile(null);
						setStatus("guest");
					}}
				/>
				<ConnectionBanner />
				<div className="page-content">
					<div className="page-stack">
						<ErrorBoundary key={page ?? "none"}>
							<Suspense fallback={<LoadingState />}>{content}</Suspense>
						</ErrorBoundary>
					</div>
				</div>
			</div>
		</div>
	);
}
