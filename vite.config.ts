import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		host: "0.0.0.0",
		port: 5173,
		watch: {
			ignored: ["**/release*/**", "**/build/**", "**/data/**"],
		},
		// Khi chạy dev, gọi API sang server nội bộ đang chạy ở cổng 3100.
		proxy: {
			"/api": "http://127.0.0.1:3100",
		},
	},
});
