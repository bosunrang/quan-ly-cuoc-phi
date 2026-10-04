import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		environmentOptions: {
			jsdom: { url: "http://localhost/" },
		},
		include: ["tests/**/*.test.{ts,tsx}"],
		setupFiles: ["tests/setup.ts"],
	},
});
