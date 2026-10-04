// Báo cho React biết đang chạy trong môi trường test để act(...) hoạt động đúng, không in cảnh báo.
(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
