import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/index.css";

// Sau khi phát hành bản mới, tab đang mở vẫn trỏ tới file của bản cũ nên mở
// màn hình chưa tải sẽ lỗi. Tải lại trang một lần để lấy bản mới; nếu vừa tải
// lại mà vẫn lỗi thì để màn hình báo lỗi hiện ra, tránh tải lại liên tục.
const RELOAD_KEY = "cuocphi.reloaded-for-update";
window.addEventListener("vite:preloadError", () => {
	let last = 0;
	try {
		last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
	} catch {
		// Trình duyệt chặn sessionStorage: vẫn tải lại, chỉ không chống lặp được.
	}
	if (Date.now() - last < 30_000) return;
	try {
		sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
	} catch {
		// Như trên.
	}
	window.location.reload();
});

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
