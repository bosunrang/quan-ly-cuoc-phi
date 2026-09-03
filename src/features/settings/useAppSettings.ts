import { useCallback, useEffect, useState } from "react";
import {
	type AppSettings,
	defaultSettings,
} from "../../domain/settings/settings.model";
import { settingsRepository } from "../../domain/settings/settings.repository";

export function useAppSettings(enabled: boolean) {
	const [settings, setSettings] = useState<AppSettings>(defaultSettings);
	const [schemaVersion, setSchemaVersion] = useState<number | null>(null);

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		void Promise.all([
			settingsRepository.get(),
			settingsRepository.schemaVersion(),
		])
			.then(([loaded, schema]) => {
				if (cancelled) return;
				setSettings(loaded);
				setSchemaVersion(schema);
			})
			.catch(() => {
				if (!cancelled) setSchemaVersion(null);
			});
		return () => {
			cancelled = true;
		};
	}, [enabled]);

	const saveSettings = useCallback(async (next: AppSettings) => {
		try {
			const saved = await settingsRepository.update(next);
			setSettings(saved);
			return true;
		} catch {
			return false;
		}
	}, []);

	return { settings, schemaVersion, saveSettings };
}
