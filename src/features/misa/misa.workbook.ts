import type { MisaParsedFile } from "../../domain/misa/misa.model";
import type { MisaWorkerResponse } from "./misa.worker";

/** Đọc file MISA trong Web Worker; luồng giao diện chỉ chờ kết quả. */
export function parseMisaWorkbook(file: File): Promise<MisaParsedFile> {
	if (file.size > 15 * 1024 * 1024) {
		return Promise.reject(
			new Error("File MISA quá lớn. Vui lòng chọn file nhỏ hơn 15 MB."),
		);
	}
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL("./misa.worker.ts", import.meta.url), {
			type: "module",
		});
		worker.onmessage = (event: MessageEvent<MisaWorkerResponse>) => {
			worker.terminate();
			if (event.data.ok) resolve(event.data.parsed);
			else reject(new Error(event.data.error));
		};
		worker.onerror = () => {
			worker.terminate();
			reject(new Error("Không thể đọc file MISA đã chọn."));
		};
		worker.postMessage(file);
	});
}
