// Đổi tên để xóa bộ nhớ đệm cũ có thể đã lưu nhầm trang HTML dưới tên file .js.
const CACHE_NAME = "cuocphi-shell-v2";
const APP_SHELL = [
	"/",
	"/manifest.webmanifest",
	"/icon-192.png",
	"/icon-512.png",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(APP_SHELL))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names
						.filter((name) => name.startsWith("cuocphi-shell-") && name !== CACHE_NAME)
						.map((name) => caches.delete(name)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (
		request.method !== "GET" ||
		url.origin !== self.location.origin ||
		url.pathname.startsWith("/api/")
	) {
		return;
	}

	event.respondWith(
		fetch(request)
			.then((response) => {
				// Trang HTML chỉ được lưu cho lần mở trang; file .js/.css mà máy chủ
				// trả về HTML là phản hồi sai, lưu lại sẽ làm lỗi kéo dài sau cập nhật.
				const isHtml = (response.headers.get("content-type") || "").includes("text/html");
				if (response.ok && (request.mode === "navigate" || !isHtml)) {
					const copy = response.clone();
					void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
				}
				return response;
			})
			.catch(async () => {
				const cached = await caches.match(request);
				if (cached) return cached;
				if (request.mode === "navigate") {
					const shell = await caches.match("/");
					if (shell) return shell;
				}
				throw new Error("Không có tài nguyên trong bộ nhớ đệm.");
			}),
	);
});
