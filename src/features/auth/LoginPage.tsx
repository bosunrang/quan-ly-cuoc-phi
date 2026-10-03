import { type FormEvent, useEffect, useState } from "react";
import { authRepository } from "../../domain/auth/auth.repository";
import {
	type AppSettings,
	defaultSettings,
} from "../../domain/settings/settings.model";
import { settingsRepository } from "../../domain/settings/settings.repository";
import { Alert } from "../../shared/ui/Alert";
import { Dialog } from "../../shared/ui/Dialog";
import type { Profile } from "../../types";

interface LoginPageProps {
	notice?: string | null;
	onSuccess: (profile: Profile) => void;
}

interface InitialPasswordPageProps {
	profile: Profile;
	onSuccess: (profile: Profile) => void;
}

export function LoginPage({ notice, onSuccess }: LoginPageProps) {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [settings, setSettings] = useState<AppSettings>(defaultSettings);
	const [showRecovery, setShowRecovery] = useState(false);
	const [recoveryCode, setRecoveryCode] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

	useEffect(() => {
		void settingsRepository
			.get()
			.then(setSettings)
			.catch(() => {});
	}, []);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		setBusy(true);
		try {
			onSuccess(await authRepository.login(username, password));
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không đăng nhập được.",
			);
			setPassword("");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="login-screen">
			<div className="login-card">
				<div className="login-brand">
					<div className="brand-mark">
						{settings.logoDataUrl ? (
							<img src={settings.logoDataUrl} alt="Logo doanh nghiệp" />
						) : (
							<span>CP</span>
						)}
					</div>
					<div className="brand-copy">
						<strong>{settings.displayName || "NAVIVA GROUP"}</strong>
						<span>{settings.tagline || "Hệ thống nội bộ"}</span>
					</div>
				</div>

				{notice && !error && <Alert tone="info">{notice}</Alert>}
				{error && <Alert tone="error">{error}</Alert>}
				{recoveryMessage && <Alert tone="success">{recoveryMessage}</Alert>}

				<form onSubmit={submit}>
					<div className="login-field">
						<label htmlFor="login-username">Tên đăng nhập</label>
						<input
							id="login-username"
							type="text"
							autoComplete="username"
							value={username}
							onChange={(event) => setUsername(event.target.value)}
						/>
					</div>
					<div className="login-field">
						<label htmlFor="login-password">Mật khẩu</label>
						<input
							id="login-password"
							type="password"
							autoComplete="current-password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</div>
					<button type="submit" className="button primary" disabled={busy}>
						{busy ? "Đang kiểm tra…" : "Đăng nhập"}
					</button>
				</form>

				<div className="login-hint">
					Quên mật khẩu?{" "}
					<button type="button" onClick={() => setShowRecovery(true)}>
						Khôi phục quản trị viên
					</button>
				</div>
			</div>

			{showRecovery && (
				<Dialog
					title="Khôi phục quản trị viên"
					subtitle="Chỉ dùng trên máy chính và cần mã khôi phục đã lưu."
					confirmLabel="Đặt mật khẩu mới"
					onClose={() => setShowRecovery(false)}
					onConfirm={async () => {
						await authRepository.recoverAdmin(
							username,
							recoveryCode,
							newPassword,
						);
						setPassword("");
						setRecoveryCode("");
						setNewPassword("");
						setShowRecovery(false);
						setRecoveryMessage(
							"Đã đặt lại mật khẩu. Bạn có thể đăng nhập lại.",
						);
					}}
				>
					<div className="field-grid">
						<div className="field">
							<label htmlFor="recovery-username">Tên quản trị viên</label>
							<input
								id="recovery-username"
								value={username}
								onChange={(event) => setUsername(event.target.value)}
							/>
						</div>
						<div className="field">
							<label htmlFor="recovery-code">Mã khôi phục</label>
							<input
								id="recovery-code"
								autoComplete="off"
								value={recoveryCode}
								onChange={(event) => setRecoveryCode(event.target.value)}
							/>
						</div>
						<div className="field">
							<label htmlFor="recovery-password">Mật khẩu mới</label>
							<input
								id="recovery-password"
								type="password"
								autoComplete="new-password"
								value={newPassword}
								onChange={(event) => setNewPassword(event.target.value)}
							/>
						</div>
					</div>
					<p className="field-hint">
						Mã sẽ mất hiệu lực sau khi dùng. Hãy tạo mã mới trong Cài đặt sau
						khi đăng nhập.
					</p>
				</Dialog>
			)}
		</div>
	);
}

/** Chặn toàn bộ app tới khi tài khoản mặc định được thay mật khẩu. */
export function InitialPasswordPage({
	profile,
	onSuccess,
}: InitialPasswordPageProps) {
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		if (newPassword !== confirmPassword) {
			setError("Xác nhận mật khẩu chưa khớp.");
			return;
		}
		setBusy(true);
		try {
			await authRepository.changeInitialPassword(newPassword);
			onSuccess(await authRepository.me());
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không đổi được mật khẩu.",
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="login-screen">
			<div className="login-card initial-password-card">
				<div className="login-brand">
					<div className="brand-mark">
						<span>CP</span>
					</div>
					<div className="brand-copy">
						<strong>Thiết lập mật khẩu</strong>
						<span>Tài khoản {profile.user.username}</span>
					</div>
				</div>
				<p className="initial-password-copy">
					Bạn đang dùng mật khẩu mặc định hoặc do quản trị viên cấp. Hãy đặt mật
					khẩu riêng trước khi sử dụng hệ thống.
				</p>
				{error && <Alert tone="error">{error}</Alert>}
				<form onSubmit={submit}>
					<div className="login-field">
						<label htmlFor="initial-password">Mật khẩu mới</label>
						<input
							id="initial-password"
							type="password"
							autoComplete="new-password"
							value={newPassword}
							onChange={(event) => setNewPassword(event.target.value)}
						/>
					</div>
					<div className="login-field">
						<label htmlFor="initial-password-confirm">
							Xác nhận mật khẩu mới
						</label>
						<input
							id="initial-password-confirm"
							type="password"
							autoComplete="new-password"
							value={confirmPassword}
							onChange={(event) => setConfirmPassword(event.target.value)}
						/>
					</div>
					<button type="submit" className="button primary" disabled={busy}>
						{busy ? "Đang lưu…" : "Lưu mật khẩu mới"}
					</button>
				</form>
			</div>
		</div>
	);
}
