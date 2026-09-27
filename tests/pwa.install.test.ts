import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallAppButton } from "../src/features/pwa/InstallAppButton";

describe("cài ứng dụng trên điện thoại", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("manifest có chế độ standalone và đủ icon bắt buộc", () => {
		const root = process.cwd();
		const manifest = JSON.parse(
			readFileSync(join(root, "public", "manifest.webmanifest"), "utf8"),
		) as {
			display: string;
			icons: Array<{ src: string; sizes: string }>;
		};
		expect(manifest.display).toBe("standalone");
		expect(manifest.icons.map((icon) => icon.sizes)).toEqual([
			"192x192",
			"512x512",
		]);

		for (const icon of manifest.icons) {
			const image = readFileSync(join(root, "public", icon.src.slice(1)));
			const size = Number(icon.sizes.split("x")[0]);
			expect(image.readUInt32BE(16)).toBe(size);
			expect(image.readUInt32BE(20)).toBe(size);
		}
	});

	it("hiện nút và gọi lời nhắc cài đặt của trình duyệt", async () => {
		const prompt = vi.fn(async () => {});
		const installEvent = Object.assign(
			new Event("beforeinstallprompt", { cancelable: true }),
			{
				prompt,
				userChoice: Promise.resolve({ outcome: "accepted" as const }),
			},
		);
		window.dispatchEvent(installEvent);

		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => root.render(createElement(InstallAppButton)));
		const button = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Cài ứng dụng vào thiết bị"]',
		);
		expect(button).toBeTruthy();
		await act(async () => button?.click());
		expect(prompt).toHaveBeenCalledOnce();
		await act(async () => root.unmount());
	});
});
