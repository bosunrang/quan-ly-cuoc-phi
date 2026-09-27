import { Download } from "lucide-react";
import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let pendingPrompt: InstallPromptEvent | null = null;
const promptListeners = new Set<(prompt: InstallPromptEvent | null) => void>();

function updatePrompt(prompt: InstallPromptEvent | null) {
	pendingPrompt = prompt;
	for (const listener of promptListeners) listener(prompt);
}

if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		updatePrompt(event as InstallPromptEvent);
	});
	window.addEventListener("appinstalled", () => updatePrompt(null));
}

function isStandalone(): boolean {
	return (
		(typeof window.matchMedia === "function" &&
			window.matchMedia("(display-mode: standalone)").matches) ||
		("standalone" in navigator &&
			Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
	);
}

export function InstallAppButton() {
	const [prompt, setPrompt] = useState<InstallPromptEvent | null>(
		isStandalone() ? null : pendingPrompt,
	);

	useEffect(() => {
		promptListeners.add(setPrompt);
		return () => {
			promptListeners.delete(setPrompt);
		};
	}, []);

	if (!prompt) return null;

	return (
		<button
			className="icon-button install-app-button"
			type="button"
			title="Cài ứng dụng"
			aria-label="Cài ứng dụng vào thiết bị"
			onClick={async () => {
				await prompt.prompt();
				await prompt.userChoice;
				updatePrompt(null);
			}}
		>
			<Download size={17} />
		</button>
	);
}
