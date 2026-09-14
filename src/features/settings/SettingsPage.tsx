import {
	Check,
	DatabaseBackup,
	FileDown,
	FileUp,
	ImagePlus,
	KeyRound,
	Save,
	Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
	AppSettings,
	DataGroup,
	SettingsBackup,
} from "../../domain/settings/settings.model";
import { settingsRepository } from "../../domain/settings/settings.repository";
import { Dialog } from "../../shared/ui/Dialog";
import { StatusPill } from "../../shared/ui/StatusPill";

interface SettingsPageProps {
	settings: AppSettings;
	schemaVersion: number | null;
	onSave: (settings: AppSettings) => Promise<boolean>;
}

export function SettingsPage({
	settings,
	schemaVersion,
	onSave,
}: SettingsPageProps) {
	const fileInput = useRef<HTMLInputElement>(null);
	const backupInput = useRef<HTMLInputElement>(null);
	const [fileName, setFileName] = useState("Chưa chọn tệp");
	const [notice, setNotice] = useState("");
	const [backupFile, setBackupFile] = useState<SettingsBackup | null>(null);
	const [backupName, setBackupName] = useState("Chưa chọn tệp backup");
	const [deleteGroups, setDeleteGroups] = useState<DataGroup[]>([]);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [showRestoreDialog, setShowRestoreDialog] = useState(false);
	const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
	const [companyName, setCompanyName] = useState(settings.companyName);
	const [companyAddress, setCompanyAddress] = useState(settings.companyAddress);
	const [displayName, setDisplayName] = useState(settings.displayName);
	const [tagline, setTagline] = useState(settings.tagline);
	const [logoDataUrl, setLogoDataUrl] = useState<string | null>(
		settings.logoDataUrl,
	);

	useEffect(() => {
		setCompanyName(settings.companyName);
		setCompanyAddress(settings.companyAddress);
		setDisplayName(settings.displayName);
		setTagline(settings.tagline);
		setLogoDataUrl(settings.logoDataUrl);
	}, [settings]);

	const showNotice = (message: string) => {
		setNotice(message);
		window.setTimeout(() => setNotice(""), 2200);
	};

	const save = async (next: AppSettings, successMessage: string) => {
		if (await onSave(next)) showNotice(successMessage);
		else showNotice("Không lưu được cài đặt. Vui lòng thử lại.");
	};

	const exportBackup = async () => {
		try {
			const backup = await settingsRepository.backup();
			const blob = new Blob([JSON.stringify(backup, null, 2)], {
				type: "application/json",
			});
			const link = document.createElement("a");
			link.href = URL.createObjectURL(blob);
			link.download = `backup-cuoc-phi-${backup.createdAt.slice(0, 10)}.json`;
			link.click();
			URL.revokeObjectURL(link.href);
			showNotice("Đã xuất tệp backup.");
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : "Không thể xuất backup.",
			);
		}
	};

	const chooseBackup = (file: File | undefined) => {
		if (!file) return;
		setBackupName(file.name);
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const parsed = JSON.parse(String(reader.result)) as SettingsBackup;
				if (parsed.format !== "cuocphi-backup" || parsed.version !== 1) {
					throw new Error("Tệp không đúng định dạng backup của Cước phí.");
				}
				setBackupFile(parsed);
				setShowRestoreDialog(true);
			} catch (error) {
				setBackupFile(null);
				showNotice(
					error instanceof Error ? error.message : "Không đọc được tệp backup.",
				);
			}
		};
		reader.readAsText(file);
	};

	const toggleDeleteGroup = (group: DataGroup) => {
		setDeleteGroups((current) =>
			current.includes(group)
				? current.filter((item) => item !== group)
				: [...current, group],
		);
	};

	return (
		<div className="settings-page">
			{notice && (
				<div className="settings-toast" role="status">
					{notice}
				</div>
			)}

			<section className="settings-profile-grid">
				<form
					className="panel settings-form-card"
					onSubmit={(event) => {
						event.preventDefault();
						void save(
							{
								...settings,
								companyName: companyName.trim(),
								companyAddress: companyAddress.trim(),
							},
							"Đã lưu thông tin doanh nghiệp.",
						);
					}}
				>
					<div className="settings-form-head">
						<h2>Thông tin doanh nghiệp</h2>
					</div>
					<div className="settings-form-body">
						<label>
							Tên doanh nghiệp
							<input
								placeholder="Nhập tên doanh nghiệp"
								value={companyName}
								onChange={(event) => setCompanyName(event.target.value)}
							/>
						</label>
						<label>
							Địa chỉ
							<input
								placeholder="Nhập địa chỉ doanh nghiệp"
								value={companyAddress}
								onChange={(event) => setCompanyAddress(event.target.value)}
							/>
						</label>
						<button className="button primary" type="submit">
							<Save size={16} /> Lưu thông tin
						</button>
					</div>
				</form>

				<form
					className="panel settings-form-card"
					onSubmit={(event) => {
						event.preventDefault();
						void save(
							{
								...settings,
								displayName: displayName.trim(),
								tagline: tagline.trim(),
								logoDataUrl,
							},
							"Đã lưu tên và nhận diện phần mềm.",
						);
					}}
				>
					<div className="settings-form-head">
						<h2>Logo &amp; tên phần mềm</h2>
					</div>
					<div className="settings-brand-body">
						<div className="settings-brand-fields">
							<label>
								Tên hiển thị
								<input
									value={displayName}
									onChange={(event) => setDisplayName(event.target.value)}
								/>
							</label>
							<label>
								Dòng phụ
								<input
									value={tagline}
									onChange={(event) => setTagline(event.target.value)}
								/>
							</label>
							<div className="settings-brand-actions">
								<button className="button primary" type="submit">
									<Save size={16} /> Lưu logo
								</button>
								<button
									className="button secondary"
									type="button"
									onClick={() => {
										setLogoDataUrl(null);
										setFileName("Chưa chọn tệp");
										if (fileInput.current) fileInput.current.value = "";
										showNotice("Đã bỏ ảnh logo. Bấm Lưu logo để xác nhận.");
									}}
								>
									Bỏ ảnh logo
								</button>
							</div>
						</div>

						<div className="settings-logo-tools">
							<span className="settings-field-label">Logo hiện tại</span>
							<div className="settings-logo-preview">
								<div className="settings-logo-mark">
									{logoDataUrl ? (
										<img src={logoDataUrl} alt="Logo đang chọn" />
									) : (
										"CP"
									)}
								</div>
								<div>
									<strong>{displayName || "Tên phần mềm"}</strong>
									<small>{tagline || "Dòng phụ"}</small>
								</div>
							</div>
							<span className="settings-field-label">Chọn ảnh logo</span>
							<div className="settings-file-row">
								<input
									ref={fileInput}
									type="file"
									accept="image/png,image/jpeg,image/webp"
									hidden
									onChange={(event) => {
										const file = event.target.files?.[0];
										setFileName(file?.name || "Chưa chọn tệp");
										if (!file) return;
										if (file.size > 1_000_000) {
											showNotice("Logo phải nhỏ hơn 1 MB.");
											return;
										}
										const reader = new FileReader();
										reader.onload = () =>
											setLogoDataUrl(
												typeof reader.result === "string"
													? reader.result
													: null,
											);
										reader.readAsDataURL(file);
									}}
								/>
								<button
									className="button secondary"
									type="button"
									onClick={() => fileInput.current?.click()}
								>
									<ImagePlus size={16} /> Chọn tệp
								</button>
								<span>{fileName}</span>
							</div>
							<p>
								Nên dùng ảnh vuông PNG/JPG, dung lượng nhỏ. Logo được lưu trên
								máy chính và dùng chung cho mọi máy.
							</p>
						</div>
					</div>
				</form>
			</section>

			<section className="panel settings-data-panel">
				<div className="settings-data-head">
					<DatabaseBackup size={18} />
					<h2>Quản trị dữ liệu</h2>
					<div className="settings-database-status">
						<StatusPill tone={schemaVersion ? "success" : "neutral"}>
							{schemaVersion
								? `SQLite · schema ${schemaVersion}`
								: "Đang kiểm tra SQLite"}
						</StatusPill>
					</div>
				</div>
				<div className="settings-data-grid">
					<article className="settings-data-card">
						<div>
							<h3>Xuất backup</h3>
							<p>
								Lưu toàn bộ dữ liệu hiện tại ra tệp sao lưu để sử dụng khi cần.
							</p>
						</div>
						<button
							className="button secondary"
							type="button"
							onClick={() => void exportBackup()}
						>
							<FileDown size={16} /> Xuất backup
						</button>
					</article>
					<article className="settings-data-card">
						<div>
							<h3>Nhập backup</h3>
							<p>Khôi phục dữ liệu từ tệp backup đã xuất trước đó.</p>
						</div>
						<input
							ref={backupInput}
							type="file"
							accept="application/json,.json"
							hidden
							onChange={(event) => chooseBackup(event.target.files?.[0])}
						/>
						<button
							className="button secondary"
							type="button"
							onClick={() => backupInput.current?.click()}
						>
							<FileUp size={16} /> Chọn file backup
						</button>
					</article>
					<article className="settings-data-card">
						<div>
							<h3>Mã khôi phục quản trị viên</h3>
							<p>
								Tạo mã dùng một lần để đặt lại mật khẩu Admin ngay trên máy
								chính.
							</p>
						</div>
						<button
							className="button secondary"
							type="button"
							onClick={() => {
								void settingsRepository
									.generateRecoveryCode()
									.then(({ code }) => setRecoveryCode(code))
									.catch((error) =>
										showNotice(
											error instanceof Error
												? error.message
												: "Không thể tạo mã khôi phục.",
										),
									);
							}}
						>
							<KeyRound size={16} /> Tạo mã khôi phục
						</button>
					</article>
					<article className="settings-data-card settings-data-danger">
						<div>
							<h3>Xóa sạch dữ liệu</h3>
							<p>
								Chọn từng nhóm dữ liệu cần xóa; tài khoản và quyền luôn được giữ
								lại.
							</p>
						</div>
						<button
							className="button danger"
							type="button"
							onClick={() => setShowDeleteDialog(true)}
						>
							<Trash2 size={16} /> Xóa sạch dữ liệu
						</button>
					</article>
				</div>
			</section>

			{recoveryCode && (
				<Dialog
					title="Lưu mã khôi phục"
					subtitle="Mã này chỉ hiển thị một lần và sẽ bị vô hiệu sau khi dùng."
					footer={
						<button
							type="button"
							className="button primary"
							onClick={() => setRecoveryCode(null)}
						>
							Đã lưu mã
						</button>
					}
					onClose={() => setRecoveryCode(null)}
					onConfirm={async () => {}}
				>
					<p className="confirm-message">
						Cất mã này ở nơi riêng tư. Người có mã có thể đặt lại mật khẩu quản
						trị viên trên máy chính.
					</p>
					<code className="recovery-code">{recoveryCode}</code>
				</Dialog>
			)}

			{showRestoreDialog && backupFile && (
				<Dialog
					title="Nhập backup"
					subtitle="Dữ liệu nghiệp vụ hiện tại sẽ được thay thế bằng dữ liệu trong tệp backup."
					confirmLabel="Nhập backup"
					onClose={() => setShowRestoreDialog(false)}
					onConfirm={async () => {
						await settingsRepository.restore(backupFile);
						setShowRestoreDialog(false);
						showNotice(`Đã nhập backup: ${backupName}.`);
						window.location.reload();
					}}
				>
					<p className="confirm-message">
						Tệp <strong>{backupName}</strong> sẽ khôi phục phiếu cước, MISA,
						danh mục, nhân viên, tính xăng và nhận diện doanh nghiệp. Tài khoản,
						quyền và nhật ký hoạt động không bị thay đổi.
					</p>
				</Dialog>
			)}

			{showDeleteDialog && (
				<Dialog
					title="Xóa dữ liệu"
					subtitle="Chọn phạm vi cần xóa. Thao tác này không thể hoàn tác nếu chưa xuất backup."
					confirmLabel={
						deleteGroups.length === 6
							? "Xóa tất cả dữ liệu"
							: "Xóa dữ liệu đã chọn"
					}
					confirmClassName="danger"
					confirmDisabled={deleteGroups.length === 0}
					className="settings-delete-dialog"
					onClose={() => setShowDeleteDialog(false)}
					onConfirm={async () => {
						await settingsRepository.deleteData(
							deleteGroups.length === 6 ? ["all"] : deleteGroups,
						);
						setShowDeleteDialog(false);
						setDeleteGroups([]);
						showNotice("Đã xóa dữ liệu đã chọn.");
					}}
				>
					<div className="settings-delete-options">
						<button
							type="button"
							className={`settings-delete-option settings-delete-all ${deleteGroups.length === 6 ? "is-selected" : ""}`}
							aria-pressed={deleteGroups.length === 6}
							onClick={() =>
								setDeleteGroups(
									deleteGroups.length === 6
										? []
										: [
												"entries",
												"misa",
												"customers",
												"carriers",
												"employees",
												"fuel",
											],
								)
							}
						>
							<span className="settings-delete-check">
								{deleteGroups.length === 6 && <Check size={13} />}
							</span>
							<strong>Tất cả dữ liệu nghiệp vụ</strong>
							<span>
								Phiếu, MISA, khách hàng, nhà xe, nhân viên và tính xăng
							</span>
						</button>
						{(
							[
								["entries", "Phiếu cước", "Các phiếu giao hàng đã lập"],
								["misa", "Dữ liệu MISA", "Các dòng đã nhập từ MISA"],
								["customers", "Khách hàng", "Danh mục và liên kết khách hàng"],
								[
									"carriers",
									"Nhà xe & bảng cước",
									"Nhà xe, liên kết và bảng cước",
								],
								["employees", "Nhân viên", "Danh sách nhân viên phụ trách"],
								[
									"fuel",
									"Lịch sử tính xăng",
									"Các lần tính xăng đã lưu; giữ nguyên mốc giá và quãng đường",
								],
							] as const
						).map(([group, title, description]) => (
							<button
								key={group}
								type="button"
								className={`settings-delete-option ${deleteGroups.includes(group) ? "is-selected" : ""}`}
								aria-pressed={deleteGroups.includes(group)}
								onClick={() => toggleDeleteGroup(group)}
							>
								<span className="settings-delete-check">
									{deleteGroups.includes(group) && <Check size={13} />}
								</span>
								<strong>{title}</strong>
								<span>{description}</span>
							</button>
						))}
					</div>
					<p className="settings-delete-note">
						Tài khoản, phân quyền và nhật ký hoạt động luôn được giữ lại.
					</p>
				</Dialog>
			)}
		</div>
	);
}
