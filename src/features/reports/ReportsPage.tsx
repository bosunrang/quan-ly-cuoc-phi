import {
	ArrowDownRight,
	ArrowUpRight,
	Download,
	FileSpreadsheet,
	Plus,
	ReceiptText,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
	CarrierVarianceReport,
	ReportData,
} from "../../domain/reports/report.model";
import { reportRepository } from "../../domain/reports/report.repository";
import { formatMoney, todayIso } from "../../shared/lib/format";
import { Alert } from "../../shared/ui/Alert";
import { DateInput } from "../../shared/ui/DateInput/DateInput";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { EmptyState, LoadingState, PanelHeader } from "../../shared/ui/Panel";
import "./reports.css";

type ExtraCost = { id: number; name: string; amount: string };
const REPORT_FROM_DRAFT_KEY = "cuocphi.report-from-draft";
const REPORT_TO_DRAFT_KEY = "cuocphi.report-to-draft";
const CARRIER_REPORT_FROM_DRAFT_KEY = "cuocphi.carrier-report-from-draft";
const CARRIER_REPORT_TO_DRAFT_KEY = "cuocphi.carrier-report-to-draft";

function savedReportDate(key: string): string {
	const value = sessionStorage.getItem(key) ?? "";
	return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayIso();
}

const download = ({
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
	link.click();
	URL.revokeObjectURL(url);
};

export function ReportsPage({ section }: { section: "employee" | "carrier" }) {
	const today = todayIso();
	const [from, setFrom] = useState(() =>
		savedReportDate(REPORT_FROM_DRAFT_KEY),
	);
	const [to, setTo] = useState(() => savedReportDate(REPORT_TO_DRAFT_KEY));
	const [carrierFrom, setCarrierFrom] = useState(() =>
		savedReportDate(CARRIER_REPORT_FROM_DRAFT_KEY),
	);
	const [carrierTo, setCarrierTo] = useState(() =>
		savedReportDate(CARRIER_REPORT_TO_DRAFT_KEY),
	);
	const [dailyEmployeeId, setDailyEmployeeId] = useState("");
	const [annualEmployeeId, setAnnualEmployeeId] = useState("");
	const [year, setYear] = useState(today.slice(0, 4));
	const [extraCosts, setExtraCosts] = useState<ExtraCost[]>([
		{ id: 1, name: "", amount: "" },
	]);
	const [data, setData] = useState<ReportData | null>(null);
	const [variance, setVariance] = useState<CarrierVarianceReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [exporting, setExporting] = useState<"daily" | "annual" | null>(null);
	const [exportingCarrier, setExportingCarrier] = useState(false);

	useEffect(() => {
		if (section !== "employee") return;
		void reportRepository
			.list()
			.then(setData)
			.catch((cause) =>
				setError(
					cause instanceof Error
						? cause.message
						: "Không tải được danh sách báo cáo.",
				),
			);
	}, [section]);
	useEffect(() => {
		if (section !== "carrier") return;
		void reportRepository
			.carrierVariance(carrierFrom, carrierTo)
			.then(setVariance)
			.catch((cause) =>
				setError(
					cause instanceof Error
						? cause.message
						: "Không tải được chênh lệch cước.",
				),
			);
	}, [carrierFrom, carrierTo, section]);

	const exportFile = async (type: "daily" | "annual") => {
		const employeeId = type === "daily" ? dailyEmployeeId : annualEmployeeId;
		if (type === "daily" && !employeeId) {
			setError("Vui lòng chọn nhân viên để xuất báo cáo theo khoảng ngày.");
			return;
		}
		setExporting(type);
		try {
			const period =
				type === "annual"
					? { from: `${year}-01-01`, to: `${year}-12-31` }
					: { from, to };
			download(
				await reportRepository.export({
					...period,
					employeeId,
					type,
					extraCosts:
						type === "daily"
							? extraCosts.map(({ name, amount }) => ({ name, amount }))
							: [],
				}),
			);
			setError(null);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không thể xuất Excel.",
			);
		} finally {
			setExporting(null);
		}
	};
	const exportCarrierVariance = async () => {
		setExportingCarrier(true);
		try {
			download(
				await reportRepository.exportCarrierVariance(carrierFrom, carrierTo),
			);
			setError(null);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không thể xuất Excel.",
			);
		} finally {
			setExportingCarrier(false);
		}
	};
	const updateExtraCost = (
		id: number,
		field: "name" | "amount",
		value: string,
	) => {
		setExtraCosts((current) =>
			current.map((item) =>
				item.id === id ? { ...item, [field]: value } : item,
			),
		);
	};
	const removeExtraCost = (id: number) => {
		setExtraCosts((current) =>
			current.length === 1
				? [{ id: 1, name: "", amount: "" }]
				: current.filter((item) => item.id !== id),
		);
	};
	const rememberFrom = (value: string) => {
		setFrom(value);
		sessionStorage.setItem(REPORT_FROM_DRAFT_KEY, value);
	};
	const rememberTo = (value: string) => {
		setTo(value);
		sessionStorage.setItem(REPORT_TO_DRAFT_KEY, value);
	};
	const rememberCarrierFrom = (value: string) => {
		setCarrierFrom(value);
		sessionStorage.setItem(CARRIER_REPORT_FROM_DRAFT_KEY, value);
	};
	const rememberCarrierTo = (value: string) => {
		setCarrierTo(value);
		sessionStorage.setItem(CARRIER_REPORT_TO_DRAFT_KEY, value);
	};

	if (section === "employee" && !data && !error) return <LoadingState />;
	if (section === "employee" && !data)
		return <EmptyState>Không tải được dữ liệu báo cáo.</EmptyState>;
	const reportData = data ?? { employees: [], years: [] };
	const years = [...new Set([year, ...reportData.years])].sort((a, b) =>
		b.localeCompare(a),
	);
	const carrierSummary = variance
		? variance.items.reduce(
				(summary, item) => {
					if (item.difference > 0) {
						summary.overEntries += 1;
						summary.overAmount += item.difference;
					} else {
						summary.underEntries += 1;
						summary.underAmount += Math.abs(item.difference);
					}
					return summary;
				},
				{ overEntries: 0, overAmount: 0, underEntries: 0, underAmount: 0 },
			)
		: null;
	return (
		<>
			{error && <Alert tone="error">{error}</Alert>}
			<section className="panel reports-intro">
				<div className="reports-intro-icon">
					<FileSpreadsheet size={22} />
				</div>
				<div>
					<h2>
						{section === "employee"
							? "Báo cáo cước nhân viên"
							: "Báo cáo chênh lệch cước nhà xe"}
					</h2>
					<p>
						{section === "employee"
							? "Tổng hợp chi phí giao hàng theo khoảng ngày hoặc theo năm."
							: "Đối chiếu cước thực tế với giá thiết lập theo nhà xe và khách hàng."}
					</p>
				</div>
				{section === "carrier" && (
					<button
						className="button primary reports-intro-action"
						type="button"
						disabled={exportingCarrier}
						onClick={() => void exportCarrierVariance()}
					>
						<Download size={16} />
						{exportingCarrier ? "Đang xuất..." : "Xuất Excel"}
					</button>
				)}
			</section>
			{section === "carrier" && variance && carrierSummary && (
				<section className="stat-overview report-carrier-stats">
					<article>
						<span className="stat-icon neutral">
							<ReceiptText size={18} />
						</span>
						<span>Phiếu chênh lệch</span>
						<strong>{variance.summary.entries}</strong>
						<small>Khác giá thiết lập nhà xe</small>
					</article>
					<article>
						<span className="stat-icon warning">
							<ArrowUpRight size={18} />
						</span>
						<span>Cước nhập cao hơn</span>
						<strong>{formatMoney(carrierSummary.overAmount)} đ</strong>
						<small>{carrierSummary.overEntries} phiếu</small>
					</article>
					<article>
						<span className="stat-icon info">
							<ArrowDownRight size={18} />
						</span>
						<span>Cước nhập thấp hơn</span>
						<strong>{formatMoney(carrierSummary.underAmount)} đ</strong>
						<small>{carrierSummary.underEntries} phiếu</small>
					</article>
					<article>
						<span className="stat-icon success">
							<FileSpreadsheet size={18} />
						</span>
						<span>Tổng chênh lệch</span>
						<strong>
							{formatMoney(variance.summary.absoluteDifference)} đ
						</strong>
						<small>Không bù trừ cước tăng và giảm</small>
					</article>
				</section>
			)}
			{section === "employee" && (
				<div className="reports-layout">
					<section className="panel report-card">
						<PanelHeader
							title="Báo cáo theo khoảng ngày"
							description="Xuất bảng kê cước gửi hàng cho một nhân viên trong kỳ chọn."
						/>
						<div className="report-form">
							<label className="field report-employee-field">
								Nhân viên
								<select
									value={dailyEmployeeId}
									onChange={(event) => setDailyEmployeeId(event.target.value)}
								>
									<option value="">Chọn nhân viên</option>
									{reportData.employees.map((item) => (
										<option value={item.id} key={item.id}>
											{item.fullName}
										</option>
									))}
								</select>
							</label>
							<div className="field">
								<span>Từ ngày</span>
								<DateInput
									value={from}
									ariaLabel="Từ ngày báo cáo"
									onChange={rememberFrom}
								/>
							</div>
							<div className="field">
								<span>Đến ngày</span>
								<DateInput
									value={to}
									ariaLabel="Đến ngày báo cáo"
									onChange={rememberTo}
								/>
							</div>
						</div>
						<div className="report-extra-cost-list">
							{extraCosts.map((item, index) => (
								<div className="report-extra-cost" key={item.id}>
									<label className="field">
										{index === 0 ? "Tên chi phí khác" : "Tên chi phí"}
										<input
											value={item.name}
											onChange={(event) =>
												updateExtraCost(item.id, "name", event.target.value)
											}
											placeholder="Ví dụ: Tiền Grab, tiền ăn..."
										/>
									</label>
									<div className="field">
										<span>Số tiền</span>
										<MoneyInput
											value={Number(item.amount.replace(/\D/g, "")) || 0}
											onValueChange={(value) =>
												updateExtraCost(item.id, "amount", String(value))
											}
											placeholder="Nhập số tiền (đ)"
										/>
									</div>
									<button
										className="row-action is-danger report-extra-cost-remove"
										type="button"
										onClick={() => removeExtraCost(item.id)}
										aria-label="Xóa chi phí khác"
									>
										<Trash2 size={16} />
									</button>
								</div>
							))}
							<button
								className="button secondary report-extra-cost-add"
								type="button"
								onClick={() =>
									setExtraCosts((current) => [
										...current,
										{ id: Date.now(), name: "", amount: "" },
									])
								}
							>
								<Plus size={16} /> Thêm chi phí
							</button>
						</div>
						<div className="report-card-footer">
							<span>
								<ReceiptText size={17} /> Bao gồm cước vận chuyển, phí cổng và
								tiền xăng.
							</span>
							<button
								className="button primary"
								type="button"
								disabled={exporting !== null}
								onClick={() => void exportFile("daily")}
							>
								<Download size={16} />
								{exporting === "daily" ? "Đang xuất..." : "Xuất báo cáo"}
							</button>
						</div>
					</section>

					<section className="panel report-card">
						<PanelHeader
							title="Báo cáo theo năm"
							description="Xuất tổng hợp cước cả năm theo nhân viên phụ trách."
						/>
						<div className="report-form report-form-annual">
							<label className="field">
								Năm
								<select
									value={year}
									onChange={(event) => setYear(event.target.value)}
								>
									{years.map((item) => (
										<option value={item} key={item}>
											{item}
										</option>
									))}
								</select>
							</label>
							<label className="field report-employee-field">
								Nhân viên
								<select
									value={annualEmployeeId}
									onChange={(event) => setAnnualEmployeeId(event.target.value)}
								>
									<option value="">Tất cả nhân viên</option>
									{reportData.employees.map((item) => (
										<option value={item.id} key={item.id}>
											{item.fullName}
										</option>
									))}
								</select>
							</label>
						</div>
						<div className="report-card-footer">
							<span>
								<FileSpreadsheet size={17} /> Chọn tất cả để xuất mỗi nhân viên
								một sheet Excel.
							</span>
							<button
								className="button primary"
								type="button"
								disabled={exporting !== null}
								onClick={() => void exportFile("annual")}
							>
								<Download size={16} />
								{exporting === "annual" ? "Đang xuất..." : "Xuất báo cáo"}
							</button>
						</div>
					</section>
				</div>
			)}
			{section === "carrier" && (
				<section className="panel report-variance-card">
					<div className="report-variance-header">
						<PanelHeader
							title="Báo cáo chênh lệch cước nhà xe"
							description="Tổng hợp theo nhà xe và đơn vị, không theo nhân viên. Chỉ tính phiếu có cước vận chuyển khác bảng giá thiết lập."
						/>
						<div className="report-variance-filters">
							<div className="field">
								<span>Từ ngày</span>
								<DateInput
									value={carrierFrom}
									ariaLabel="Từ ngày báo cáo nhà xe"
									onChange={rememberCarrierFrom}
								/>
							</div>
							<div className="field">
								<span>Đến ngày</span>
								<DateInput
									value={carrierTo}
									ariaLabel="Đến ngày báo cáo nhà xe"
									onChange={rememberCarrierTo}
								/>
							</div>
						</div>
					</div>
					{variance?.items.length ? (
						<div className="table-scroll report-variance-table">
							<table>
								<colgroup>
									<col className="variance-col-index" />
									<col className="variance-col-carrier" />
									<col className="variance-col-customer" />
									<col className="variance-col-spec" />
									<col className="variance-col-money" />
									<col className="variance-col-money" />
									<col className="variance-col-money" />
									<col className="variance-col-note" />
								</colgroup>
								<thead>
									<tr>
										<th>STT</th>
										<th>Nhà xe</th>
										<th>Khách hàng</th>
										<th>Quy cách</th>
										<th>Giá thiết lập</th>
										<th>Giá nhập</th>
										<th>Chênh lệch</th>
										<th>Ghi chú</th>
									</tr>
								</thead>
								<tbody>
									{variance.items.map((item, index) => (
										<tr key={item.id}>
											<td>{index + 1}</td>
											<td>{item.carrier}</td>
											<td>{item.customer}</td>
											<td>{item.spec}</td>
											<td>{formatMoney(item.standardFee)} đ</td>
											<td>{formatMoney(item.actualFee)} đ</td>
											<td
												className={item.difference > 0 ? "is-over" : "is-under"}
											>
												{item.difference > 0 ? "+" : ""}
												{formatMoney(item.difference)} đ
											</td>
											<td>{item.varianceNote || "—"}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<EmptyState>
							Không có phiếu chênh lệch cước trong khoảng ngày này.
						</EmptyState>
					)}
				</section>
			)}
		</>
	);
}
