import { RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import {
	checkServerConnection,
	getServerConnectionStatus,
	subscribeServerConnection,
} from "../../shared/api/client";

export function ConnectionBanner() {
	const [status, setStatus] = useState(getServerConnectionStatus);

	useEffect(() => subscribeServerConnection(setStatus), []);

	useEffect(() => {
		if (status !== "unreachable") return;
		const timer = window.setTimeout(() => void checkServerConnection(), 10_000);
		return () => window.clearTimeout(timer);
	}, [status]);

	if (status === "online") return null;

	const message =
		status === "offline"
			? "Thiết bị đang mất mạng. Phiếu đang nhập vẫn được lưu nháp."
			: status === "checking"
				? "Đang kiểm tra lại kết nối máy chủ…"
				: "Không kết nối được máy chủ. Kiểm tra máy chính và mạng nội bộ.";

	return (
		<div className="connection-banner" role="status">
			<WifiOff size={17} />
			<span>{message}</span>
			<button
				type="button"
				disabled={status === "checking"}
				onClick={() => void checkServerConnection()}
			>
				<RefreshCw size={15} />
				Thử lại
			</button>
		</div>
	);
}
