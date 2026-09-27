import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Không tìm thấy phần tử #root.");

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		void navigator.serviceWorker.register("/sw.js").catch(() => {
			// Trình duyệt hoặc HTTP nội bộ có thể không cho đăng ký service worker.
			// Ứng dụng web vẫn hoạt động bình thường trong trường hợp này.
		});
	});
}
