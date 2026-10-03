import { readSheet } from "read-excel-file/web-worker";
import type { MisaParsedFile } from "../../domain/misa/misa.model";
import { parseMisaRows } from "./misa.import";

export type MisaWorkerResponse =
	| { ok: true; parsed: MisaParsedFile }
	| { ok: false; error: string };

// Đọc XML của file Excel và chuẩn hóa hàng chục nghìn dòng MISA tốn vài giây;
// chạy trong Web Worker để màn hình vẫn phản hồi trong lúc chờ.
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<File>) => void) | null;
	postMessage(message: MisaWorkerResponse): void;
};

scope.onmessage = async (event) => {
	const file = event.data;
	try {
		scope.postMessage({
			ok: true,
			parsed: parseMisaRows(file.name, await readSheet(file)),
		});
	} catch (cause) {
		scope.postMessage({
			ok: false,
			error:
				cause instanceof Error
					? cause.message
					: "Không thể đọc file MISA đã chọn.",
		});
	}
};
