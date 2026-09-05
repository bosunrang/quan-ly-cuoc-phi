import { api } from "../../shared/api/client";
import type { AppSettings, DataGroup, SettingsBackup } from "./settings.model";

export const settingsRepository = {
	get(): Promise<AppSettings> {
		return api<AppSettings>("GET", "/api/settings");
	},

	update(settings: AppSettings): Promise<AppSettings> {
		return api<AppSettings>("PATCH", "/api/settings", settings);
	},

	async schemaVersion(): Promise<number> {
		const result = await api<{ schema: number }>("GET", "/api/health");
		return result.schema;
	},

	backup(): Promise<SettingsBackup> {
		return api<SettingsBackup>("GET", "/api/settings/backup", undefined, {
			timeoutMs: 120_000,
		});
	},

	restore(backup: SettingsBackup): Promise<{ restored: boolean }> {
		return api(
			"POST",
			"/api/settings/backup/restore",
			{ backup },
			{
				timeoutMs: 120_000,
			},
		);
	},

	deleteData(groups: DataGroup[] | ["all"]): Promise<{ deleted: string[] }> {
		return api("POST", "/api/settings/data/delete", { groups });
	},

	generateRecoveryCode(): Promise<{ code: string }> {
		return api("POST", "/api/settings/recovery-code");
	},
};
