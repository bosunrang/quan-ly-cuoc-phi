/**
 * Lớp gọi máy chủ duy nhất.
 *
 * Quy tắc: feature và domain không được tự gọi `fetch`. Mọi yêu cầu đi qua
 * đây để token và việc xử lý hết phiên chỉ nằm ở một chỗ.
 */

const TOKEN_KEY = "cuocphi.token";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface ApiRequestOptions {
	/** Tăng cho các thao tác nhập/xuất hoặc khôi phục dữ liệu lớn. */
	timeoutMs?: number;
}

let token: string | null = sessionStorage.getItem(TOKEN_KEY);
let onUnauthorized: () => void = () => {};

export type ServerConnectionStatus =
	| "online"
	| "offline"
	| "checking"
	| "unreachable";

let connectionStatus: ServerConnectionStatus =
	typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online";
const connectionListeners = new Set<(status: ServerConnectionStatus) => void>();

function setConnectionStatus(status: ServerConnectionStatus): void {
	if (connectionStatus === status) return;
	connectionStatus = status;
	for (const listener of connectionListeners) listener(status);
}

if (typeof window !== "undefined") {
	window.addEventListener("offline", () => setConnectionStatus("offline"));
	window.addEventListener("online", () => void checkServerConnection());
}

export function getServerConnectionStatus(): ServerConnectionStatus {
	return connectionStatus;
}

export function subscribeServerConnection(
	listener: (status: ServerConnectionStatus) => void,
): () => void {
	connectionListeners.add(listener);
	return () => connectionListeners.delete(listener);
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

export function setToken(value: string | null): void {
	token = value;
	if (value) sessionStorage.setItem(TOKEN_KEY, value);
	else sessionStorage.removeItem(TOKEN_KEY);
}

export const hasToken = (): boolean => Boolean(token);

/** Đăng ký việc cần làm khi máy chủ báo phiên không còn hiệu lực. */
export function setUnauthorizedHandler(handler: () => void): void {
	onUnauthorized = handler;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export async function api<T>(
	method: Method,
	path: string,
	body?: unknown,
	options: ApiRequestOptions = {},
): Promise<T> {
	let response: Response;
	const sentToken = Boolean(token);
	const controller = new AbortController();
	const timeout = window.setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	);
	try {
		response = await fetch(path, {
			method,
			signal: controller.signal,
			headers: {
				...(token ? { authorization: `Bearer ${token}` } : {}),
				...(body ? { "content-type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		setConnectionStatus("online");
	} catch {
		// Hết thời gian chờ nghĩa là máy chủ đang bận xử lý (ví dụ xuất báo cáo
		// lớn), không phải mất kết nối; không bật dải báo "không kết nối được".
		if (!controller.signal.aborted) {
			setConnectionStatus(
				typeof navigator !== "undefined" && !navigator.onLine
					? "offline"
					: "unreachable",
			);
		}
		if (controller.signal.aborted) {
			throw new ApiError(
				"Máy chủ đang xử lý lâu hơn dự kiến. Yêu cầu có thể vẫn đang hoàn tất; hãy tải lại trang trước khi thử lại.",
				0,
			);
		}
		throw new ApiError(
			"Không kết nối được máy chủ. Kiểm tra máy chính đã bật chưa.",
			0,
		);
	} finally {
		window.clearTimeout(timeout);
	}

	const data = (await response.json().catch(() => null)) as {
		error?: string;
	} | null;

	if (!response.ok) {
		// Chỉ coi là "hết phiên" khi yêu cầu có gửi token. Sai mã khôi phục hay
		// sai mật khẩu ở màn đăng nhập không được làm hiện thông báo hết phiên.
		if (response.status === 401 && sentToken && path !== "/api/login") {
			setToken(null);
			onUnauthorized();
		}
		throw new ApiError(
			data?.error ?? "Máy chủ không xử lý được yêu cầu.",
			response.status,
		);
	}
	return data as T;
}

/** Chỉ kiểm tra kết nối; không tự gửi lại thao tác ghi để tránh tạo dữ liệu trùng. */
export async function checkServerConnection(): Promise<boolean> {
	if (typeof navigator !== "undefined" && !navigator.onLine) {
		setConnectionStatus("offline");
		return false;
	}
	setConnectionStatus("checking");
	try {
		await api("GET", "/api/health", undefined, { timeoutMs: 5_000 });
		return true;
	} catch {
		return false;
	}
}
