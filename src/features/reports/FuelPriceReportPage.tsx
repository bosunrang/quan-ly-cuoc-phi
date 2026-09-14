import { ChevronLeft, ChevronRight, Download, Fuel } from "lucide-react";
import { useEffect, useState } from "react";
import type { FuelHistoryReport } from "../../domain/reports/report.model";
import { reportRepository } from "../../domain/reports/report.repository";
import { formatDate, formatMoney, todayIso } from "../../shared/lib/format";
import { Alert } from "../../shared/ui/Alert";
import { DateInput } from "../../shared/ui/DateInput/DateInput";
import { EmptyState, LoadingState, PanelHeader } from "../../shared/ui/Panel";
import "./reports.css";

const monthStart = () => `${todayIso().slice(0, 7)}-01`;
const HISTORY_PAGE_SIZE = 20;
const decimal = (value: number) =>
	Number.isInteger(value)
		? value.toLocaleString("vi-VN")
		: value.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

const errorMessage = (cause: unknown, fallback: string) =>
	cause instanceof Error ? cause.message : fallback;

const downloadExcel = ({
	fileName,
	contentBase64,
}: {
	fileName: string;
	contentBase64: string;
}) => {
	const binary = atob(contentBase64);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	const url = URL.createObjectURL(
		new Blob([bytes], {
			type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		}),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.style.display = "none";
	document.body.append(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export function FuelPriceReportPage() {
	const [from, setFrom] = useState(monthStart);
	const [to, setTo] = useState(todayIso);
	const [employeeId, setEmployeeId] = useState("");
	const [historyPage, setHistoryPage] = useState(1);
	const [data, setData] = useState<FuelHistoryReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);

	useEffect(() => {
		let isCurrent = true;
		void reportRepository
			.fuelHistory({
				from,
				to,
				employeeId,
				limit: HISTORY_PAGE_SIZE,
				offset: (historyPage - 1) * HISTORY_PAGE_SIZE,
			})
			.then((next) => {
				if (!isCurrent) return;
				if (!employeeId && next.employees.length) {
					setEmployeeId(String(next.employees[0].id));
					return;
				}
				setData(next);
				setError(null);
			})
			.catch((cause) => {
				if (isCurrent)
					setError(errorMessage(cause, "Không tải được báo cáo tiền xăng."));
			});
		return () => {
			isCurrent = false;
		};
	}, [employeeId, from, historyPage, to]);

	const exportFile = async () => {
		setExporting(true);
		try {
			downloadExcel(
				await reportRepository.exportFuelHistory({
					from,
					to,
					employeeId,
				}),
			);
			setError(null);
		} catch (cause) {
			setError(errorMessage(cause, "Không thể xuất Excel."));
		} finally {
			setExporting(false);
		}
	};

	const historyPageCount = Math.max(
		1,
		Math.ceil((data?.recordsTotal ?? 0) / HISTORY_PAGE_SIZE),
	);
	useEffect(() => {
		if (historyPage > historyPageCount) setHistoryPage(historyPageCount);
	}, [historyPage, historyPageCount]);

	if (!data && !error) return <LoadingState />;
	if (!data)
		return <Alert tone="error">{error ?? "Không tải được báo cáo."}</Alert>;
	const changeEmployee = (value: string) => {
		setEmployeeId(value);
		setHistoryPage(1);
	};
	const changeFrom = (value: string) => {
		setFrom(value);
		setHistoryPage(1);
	};
	const changeTo = (value: string) => {
		setTo(value);
		setHistoryPage(1);
	};

	return (
		<>
			{error && <Alert tone="error">{error}</Alert>}
			<section className="panel reports-intro">
				<div className="reports-intro-icon">
					<Fuel size={22} />
				</div>
				<div>
					<h2>Báo cáo tiền xăng</h2>
					<p>Lịch sử các kỳ tính xăng đã lưu trong hệ thống.</p>
				</div>
				<button
					className="button primary reports-intro-action"
					type="button"
					disabled={exporting || data.recordsTotal === 0}
					onClick={() => void exportFile()}
				>
					<Download size={16} />
					{exporting ? "Đang xuất..." : "Xuất Excel"}
				</button>
			</section>
			<section className="panel fuel-price-report-card">
				<div className="fuel-price-report-header">
					<PanelHeader
						title="Lịch sử tính tiền xăng"
						description="Lọc theo kỳ và nhân viên."
					/>
					<div className="fuel-price-report-filters">
						<label className="field">
							<span>Nhân viên</span>
							<select
								value={employeeId}
								onChange={(event) => changeEmployee(event.target.value)}
							>
								{data.employees.map((item) => (
									<option key={item.id} value={item.id}>
										{item.fullName}
									</option>
								))}
							</select>
						</label>
						<div className="field">
							<span>Từ ngày</span>
							<DateInput
								value={from}
								ariaLabel="Từ ngày báo cáo tiền xăng"
								onChange={changeFrom}
							/>
						</div>
						<div className="field">
							<span>Đến ngày</span>
							<DateInput
								value={to}
								ariaLabel="Đến ngày báo cáo tiền xăng"
								onChange={changeTo}
							/>
						</div>
					</div>
				</div>
				{data.items.length ? (
					<>
						<div className="table-scroll fuel-price-report-table">
							<table>
								<thead>
									<tr>
										<th>Kỳ tính</th>
										<th>Nhân viên</th>
										<th>Chi tiết lộ trình</th>
										<th>Quãng đường</th>
										<th>Giá xăng</th>
										<th>Tổng tiền</th>
									</tr>
								</thead>
								<tbody>
									{data.items.flatMap((item) => {
										const legs = item.legs.length
											? item.legs
											: [
													{
														sequenceNo: 0,
														from: "Chưa lưu chi tiết lộ trình",
														to: "",
														km: item.distanceKm,
													},
												];
										return legs.map((leg, index) => (
											<tr
												key={`${item.id}-${leg.sequenceNo}`}
												className={item.status === "voided" ? "is-voided" : ""}
											>
												{index === 0 && (
													<>
														<td rowSpan={legs.length}>
															{formatDate(item.periodFrom)} –{" "}
															{formatDate(item.periodTo)}
														</td>
														<td rowSpan={legs.length}>{item.employeeName}</td>
													</>
												)}
												<td className="fuel-route-detail">
													{leg.to ? `${leg.from} → ${leg.to}` : leg.from}
												</td>
												<td className="fuel-route-distance">
													{decimal(leg.km)} km
												</td>
												{index === 0 && (
													<>
														<td rowSpan={legs.length}>
															{formatMoney(item.fuelPrice)} đ/lít
														</td>
														<td
															rowSpan={legs.length}
															className="fuel-price-report-money"
														>
															{formatMoney(item.totalFee)} đ
														</td>
													</>
												)}
											</tr>
										));
									})}
								</tbody>
							</table>
						</div>
						{historyPageCount > 1 && (
							<footer className="fuel-price-report-pagination">
								<button
									type="button"
									className="button secondary"
									title="Trang trước"
									aria-label="Trang trước"
									disabled={historyPage === 1}
									onClick={() => setHistoryPage((page) => page - 1)}
								>
									<ChevronLeft size={16} />
								</button>
								<span>
									Trang {historyPage} / {historyPageCount}
								</span>
								<button
									type="button"
									className="button secondary"
									title="Trang sau"
									aria-label="Trang sau"
									disabled={historyPage === historyPageCount}
									onClick={() => setHistoryPage((page) => page + 1)}
								>
									<ChevronRight size={16} />
								</button>
							</footer>
						)}
					</>
				) : (
					<EmptyState>
						Chưa có kỳ tính xăng phù hợp với điều kiện lọc.
					</EmptyState>
				)}
			</section>
		</>
	);
}
