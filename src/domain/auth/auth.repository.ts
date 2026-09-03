import { api, setToken } from "../../shared/api/client";
import type { LoginResult, Profile } from "../../types";

export const authRepository = {
	async devLogin(): Promise<LoginResult> {
		const result = await api<LoginResult>("POST", "/api/dev-login");
		setToken(result.token);
		return result;
	},

	async login(username: string, password: string): Promise<LoginResult> {
		const result = await api<LoginResult>("POST", "/api/login", {
			username,
			password,
		});
		setToken(result.token);
		return result;
	},

	recoverAdmin(
		username: string,
		code: string,
		password: string,
	): Promise<{ ok: true }> {
		return api<{ ok: true }>("POST", "/api/recover-admin", {
			username,
			code,
			password,
		});
	},

	async logout(): Promise<void> {
		try {
			await api("POST", "/api/logout");
		} catch {
			// Máy chủ từ chối cũng không sao: phía máy này vẫn phải thoát.
		}
		setToken(null);
	},

	/** Dùng lúc mở app để biết phiên còn hiệu lực và được mở thẻ nào. */
	me(): Promise<Profile> {
		return api<Profile>("GET", "/api/me");
	},

	changePassword(
		currentPassword: string,
		newPassword: string,
	): Promise<{ ok: true }> {
		return api<{ ok: true }>("POST", "/api/me/password", {
			currentPassword,
			newPassword,
		});
	},

	changeInitialPassword(newPassword: string): Promise<{ ok: true }> {
		return api<{ ok: true }>("POST", "/api/me/initial-password", {
			newPassword,
		});
	},
};
