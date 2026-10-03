import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert } from "./Alert";

interface Props {
	children: ReactNode;
}

interface State {
	error: Error | null;
}

/**
 * Chặn lỗi hiển thị trong một màn hình để phần còn lại của ứng dụng (thanh
 * điều hướng, các thẻ khác) vẫn dùng được thay vì cả cửa sổ trắng trơn.
 * Đặt `key` theo thẻ đang mở để chuyển thẻ là tự xóa trạng thái lỗi.
 */
export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("[giao-dien]", error, info.componentStack);
	}

	render(): ReactNode {
		const { error } = this.state;
		if (!error) return this.props.children;
		return (
			<section className="panel data-panel">
				<Alert tone="error">
					Màn hình này gặp lỗi khi hiển thị. Dữ liệu đã lưu không bị ảnh hưởng.
				</Alert>
				<div className="inline-actions">
					<button
						type="button"
						className="button primary"
						onClick={() => this.setState({ error: null })}
					>
						Thử lại
					</button>
					<button
						type="button"
						className="button secondary"
						onClick={() => window.location.reload()}
					>
						Tải lại ứng dụng
					</button>
				</div>
			</section>
		);
	}
}
