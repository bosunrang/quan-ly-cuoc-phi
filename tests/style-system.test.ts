import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(
	resolve("src/styles/foundation/tokens.css"),
	"utf8",
);
const components = readFileSync(
	resolve("src/styles/shared/components.css"),
	"utf8",
);

describe("hệ thống giao diện đồng bộ Marketing App", () => {
	it("giữ nguyên thang cỡ chữ toàn ứng dụng", () => {
		const sizes = {
			overline: "10.5px",
			caption: "12px",
			meta: "13px",
			"body-sm": "13.5px",
			body: "14px",
			subhead: "14.5px",
			"heading-sm": "16px",
			"dialog-title": "18px",
			"heading-lg": "24px",
			"page-title": "26px",
			kpi: "30px",
		};

		for (const [name, size] of Object.entries(sizes)) {
			expect(tokens).toContain(`--type-${name}:${size};`);
		}
	});

	it.each(["success", "warning", "info", "neutral", "danger"])(
		"có đủ nền, viền và chữ cho trạng thái %s",
		(tone) => {
			expect(tokens).toContain(`--status-${tone}-bg:`);
			expect(tokens).toContain(`--status-${tone}-border:`);
			expect(tokens).toContain(`--status-${tone}-text:`);
			expect(components).toContain(`.status-pill-${tone}`);
		},
	);
});
