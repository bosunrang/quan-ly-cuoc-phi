import { describe, expect, it } from "vitest";
import { localIsoDate } from "../src/shared/lib/format";

describe("localIsoDate", () => {
	it("giữ ngày theo múi giờ cục bộ thay vì đổi sang UTC", () => {
		expect(localIsoDate(new Date(2026, 1, 3, 0, 30))).toBe("2026-02-03");
	});
});
