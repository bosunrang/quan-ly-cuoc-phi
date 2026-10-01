import {
	Fuel,
	LayoutGrid,
	ReceiptText,
	Truck,
	WalletCards,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type {
	DashboardData,
	DashboardFilters,
} from "../../domain/dashboard/dashboard.model";
import { dashboardRepository } from "../../domain/dashboard/dashboard.repository";
import { formatDate, formatMoney, todayIso } from "../../shared/lib/format";
import { Alert } from "../../shared/ui/Alert";
import { DateInput } from "../../shared/ui/DateInput/DateInput";
import { EmptyState, LoadingState, PanelHeader } from "../../shared/ui/Panel";
import "./dashboard.css";

const parts = [
	["transport", "Cước vận chuyển", "transport"],
	["gate", "Phí vào cổng", "gate"],
	["other", "Chi phí khác", "other"],
	["fuel", "Tiền xăng", "fuel"],
] as const;
const DASHBOARD_FROM_DRAFT_KEY = "cuocphi.dashboard-from-draft";
const DASHBOARD_TO_DRAFT_KEY = "cuocphi.dashboard-to-draft";

function savedDashboardDate(key: string) {
	const value = sessionStorage.getItem(key) ?? "";
	return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayIso();
}

function defaults(): DashboardFilters {
	return {
		from: savedDashboardDate(DASHBOARD_FROM_DRAFT_KEY),
		to: savedDashboardDate(DASHBOARD_TO_DRAFT_KEY),
	};
}
function Bar({
	transport,
	gate,
	other,
	fuel,
}: Pick<
	DashboardData["daily"][number],
	"transport" | "gate" | "other" | "fuel"
>) {
	const total = transport + gate + other + fuel;
	return (
		<span className="dash-bar">
			{parts.map(([key, , tone]) => {
				const value = { transport, gate, other, fuel }[key];
				return value ? (
					<i key={key} className={tone} style={{ flex: value / total }} />
				) : null;
			})}
		</span>
	);
}

export function DashboardPage() {
	const [filters, setFilters] = useState(defaults);
	const [data, setData] = useState<DashboardData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const rememberDate = (key: string, field: "from" | "to", value: string) => {
		sessionStorage.setItem(key, value);
		setFilters((current) => ({ ...current, [field]: value }));
	};
	useEffect(() => {
		let live = true;
		void dashboardRepository
			.get(filters)
			.then((next) => {
				if (live) {
					setData(next);
					setError(null);
				}
			})
			.catch(
				(cause) =>
					live &&
					setError(
						cause instanceof Error
							? cause.message
							: "Không tải được tổng quan.",
					),
			);
		return () => {
			live = false;
		};
	}, [filters]);
	if (!data && !error) return <LoadingState />;
	if (!data) return <Alert tone="error">{error}</Alert>;
	const maxDaily = Math.max(...data.daily.map((item) => item.total), 1);
	const maxMonthlyVariance = Math.max(
		...data.monthlyVariance.flatMap((item) => [
			item.standardFee,
			item.actualFee,
		]),
		1,
	);
	const costTotal = Math.max(
		data.summary.transport +
			data.summary.gate +
			data.summary.other +
			data.summary.fuel,
		1,
	);
	const costShares = parts.map(([key, label, tone]) => ({
		key,
		label,
		tone,
		amount: data.summary[key],
		share: (data.summary[key] / costTotal) * 100,
	}));
	const costGradient = `conic-gradient(var(--chart-transport) 0 ${costShares[0].share}%, var(--chart-gate) ${costShares[0].share}% ${costShares[0].share + costShares[1].share}%, var(--chart-other) ${costShares[0].share + costShares[1].share}% ${costShares[0].share + costShares[1].share + costShares[2].share}%, var(--chart-fuel) ${costShares[0].share + costShares[1].share + costShares[2].share}% 100%)`;
	return (
		<div className="dashboard-page">
			<section className="panel dashboard-intro">
				<span className="dashboard-icon">
					<LayoutGrid size={22} />
				</span>
				<div>
					<h2>Tổng quan chi phí</h2>
					<p>Tình hình cước phí, nhiên liệu và giao hàng trong kỳ đã chọn.</p>
				</div>
				<div className="dashboard-filters">
					{data.scope === "all" && (
						<label className="dashboard-filter-field dashboard-employee-filter">
							Nhân viên
							<select
								value={filters.employeeId ?? ""}
								onChange={(event) =>
									setFilters((current) => ({
										...current,
										employeeId: event.target.value || undefined,
									}))
								}
							>
								<option value="">Tất cả nhân viên</option>
								{data.employees.map((item) => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
							</select>
						</label>
					)}
					<div className="dashboard-filter-field">
						Từ ngày
						<DateInput
							value={filters.from}
							ariaLabel="Từ ngày tổng quan"
							onChange={(from) =>
								rememberDate(DASHBOARD_FROM_DRAFT_KEY, "from", from)
							}
						/>
					</div>
					<div className="dashboard-filter-field">
						Đến ngày
						<DateInput
							value={filters.to}
							ariaLabel="Đến ngày tổng quan"
							onChange={(to) => rememberDate(DASHBOARD_TO_DRAFT_KEY, "to", to)}
						/>
					</div>
				</div>
			</section>
			{error && <Alert tone="error">{error}</Alert>}
			<section className="stat-overview dashboard-stats">
				<Stat
					icon={<Truck size={18} />}
					label="Tổng thanh toán"
					value={`${formatMoney(data.summary.total)} đ`}
					note="Cước, phí cổng, chi phí khác và tiền xăng"
				/>
				<Stat
					icon={<ReceiptText size={18} />}
					label="Phiếu cước"
					value={String(data.summary.entries)}
					note="Trong khoảng ngày đã chọn"
				/>
				<Stat
					icon={<Fuel size={18} />}
					label="Tiền xăng"
					value={`${formatMoney(data.summary.fuel)} đ`}
					note="Đã lưu kỳ tính xăng"
				/>
				<Stat
					icon={<WalletCards size={18} />}
					label="Chênh lệch cước"
					value={`${formatMoney(data.summary.varianceAmount)} đ`}
					note={`${data.summary.varianceEntries} phiếu khác bảng giá nhà xe`}
				/>
			</section>
			<section className="panel dashboard-panel dash-variance">
				<PanelHeader
					title="Chênh lệch cước theo tháng"
					description="Đối chiếu tổng cước thực tế với mức cước thiết lập trên các phiếu chênh lệch."
				/>
				{data.monthlyVariance.length ? (
					<div className="dash-variance-chart">
						<div className="dash-variance-legend">
							<span>
								<i className="standard" /> Cước thiết lập
							</span>
							<span>
								<i className="actual" /> Cước thực tế
							</span>
						</div>
						<div className="dash-monthly-variance">
							{data.monthlyVariance.map((item) => (
								<div key={item.month}>
									<div className="dash-monthly-bars">
										<span
											className="standard"
											style={{
												height: `${Math.max((item.standardFee / maxMonthlyVariance) * 100, 3)}%`,
											}}
										/>
										<span
											className="actual"
											style={{
												height: `${Math.max((item.actualFee / maxMonthlyVariance) * 100, 3)}%`,
											}}
										/>
									</div>
									<strong
										className={item.difference > 0 ? "is-over" : "is-under"}
									>
										{item.difference > 0 ? "+" : ""}
										{formatMoney(item.difference)} đ
									</strong>
									<small>{item.month.split("-").reverse().join("/")}</small>
								</div>
							))}
						</div>
					</div>
				) : (
					<EmptyState>Chưa có chênh lệch cước trong kỳ.</EmptyState>
				)}
			</section>
			<section className="dashboard-grid">
				<section className="panel dashboard-panel">
					<PanelHeader
						title="Chi phí theo ngày"
						description="Cước vận chuyển, phí vào cổng, chi phí khác và tiền xăng."
					/>
					{data.daily.length ? (
						<div className="dash-daily">
							{data.daily.map((item) => (
								<div key={item.day}>
									<b>{formatMoney(item.total)}</b>
									<span className="dash-day-track">
										<span
											style={{
												height: `${Math.max((item.total / maxDaily) * 100, 3)}%`,
											}}
										>
											<Bar {...item} />
										</span>
									</span>
									<small>{formatDate(item.day).slice(0, 5)}</small>
								</div>
							))}
						</div>
					) : (
						<EmptyState>Chưa có chi phí trong kỳ.</EmptyState>
					)}
				</section>
				<section className="panel dashboard-panel dash-cost-panel">
					<PanelHeader
						title="Cơ cấu tổng chi phí"
						description="Tỷ trọng cước vận chuyển, phí cổng, chi phí khác và tiền xăng."
					/>
					<div className="dash-cost-overview">
						<div className="dash-donut" style={{ background: costGradient }}>
							<div>
								<small>Tổng chi phí</small>
								<strong>{formatMoney(data.summary.total)} đ</strong>
							</div>
						</div>
						<div className="dash-costs">
							{costShares.map((item) => (
								<div key={item.key}>
									<span>
										<i className={item.tone} />
										{item.label}
									</span>
									<small>{item.share.toFixed(1)}%</small>
									<b>{formatMoney(item.amount)} đ</b>
								</div>
							))}
						</div>
					</div>
				</section>
			</section>
		</div>
	);
}
function Stat({
	icon,
	label,
	value,
	note,
}: {
	icon: ReactNode;
	label: string;
	value: string;
	note: string;
}) {
	return (
		<article>
			<span className="stat-icon success">{icon}</span>
			<span>{label}</span>
			<strong>{value}</strong>
			<small>{note}</small>
		</article>
	);
}
