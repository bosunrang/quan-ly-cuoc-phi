import type { ReactNode } from "react";

interface AlertProps {
	tone: "error" | "success" | "info";
	children: ReactNode;
}

/** Dải thông báo trong biểu mẫu và màn hình đăng nhập. */
export function Alert({ tone, children }: AlertProps) {
	return <div className={`form-alert is-${tone}`}>{children}</div>;
}
