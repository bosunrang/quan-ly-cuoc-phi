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
	} catch {
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
		if (response.status === 401 && path !== "/api/login") {
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
