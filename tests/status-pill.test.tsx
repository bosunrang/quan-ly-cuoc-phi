import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	StatusPill,
	type StatusTone,
} from "../src/shared/ui/StatusPill";

describe("StatusPill dùng chung toàn ứng dụng", () => {
	const tones: StatusTone[] = [
		"success",
		"warning",
		"info",
		"neutral",
		"danger",
	];

	it.each(tones)("dùng class màu ngữ nghĩa %s", (tone) => {
		const markup = renderToStaticMarkup(
			<StatusPill tone={tone}>Trạng thái</StatusPill>,
		);

		expect(markup).toContain(`status-pill status-pill-${tone}`);
		expect(markup).toContain("Trạng thái");
	});

	it("hỗ trợ icon, class mở rộng và mô tả", () => {
		const markup = renderToStaticMarkup(
			<StatusPill
				tone="success"
				className="feature-status"
				title="Đang hoạt động"
				icon={<i aria-hidden="true" />}
			>
				Hoạt động
			</StatusPill>,
		);

		expect(markup).toContain("feature-status");
		expect(markup).toContain('title="Đang hoạt động"');
		expect(markup).toContain("aria-hidden");
	});
});
