import {
	KeyRound,
	Lock,
	Pencil,
	Plus,
	Trash2,
	Unlock,
	UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GrantablePage, ManagedUser } from "../../domain/users/user.model";
import { userRepository } from "../../domain/users/user.repository";
import { Alert } from "../../shared/ui/Alert";
import { Dialog } from "../../shared/ui/Dialog";
import { LoadingState, Panel, PanelHeader } from "../../shared/ui/Panel";
import { StatusPill } from "../../shared/ui/StatusPill";
import type { CurrentUser, PageId } from "../../types";
import { PasswordDialog } from "./components/PasswordDialog";
import { UserDialog } from "./components/UserDialog";
import "./users.css";

interface UsersPageProps {
	currentUser: CurrentUser;
}

export function UsersPage({ currentUser }: UsersPageProps) {
	const [users, setUsers] = useState<ManagedUser[] | null>(null);
	const [grantable, setGrantable] = useState<GrantablePage[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState<ManagedUser | null | undefined>(
		undefined,
	);
	const [resetting, setResetting] = useState<ManagedUser | null>(null);
	const [deleting, setDeleting] = useState<ManagedUser | null>(null);

	const load = useCallback(async () => {
		try {
			setError(null);
			const [list, pages] = await Promise.all([
				userRepository.list(),
				userRepository.grantablePages(),
			]);
			setUsers(list);
			setGrantable(pages);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Không tải được.");
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const labelOf = (key: PageId) =>
		grantable.find((page) => page.key === key)?.label ?? key;

	const save = async (input: {
		username: string;
		fullName: string;
		password: string;
		isAdmin: boolean;
		pages: PageId[];
	}) => {
		if (editing) {
			await userRepository.update(editing.id, {
				fullName: input.fullName,
				pages: input.pages,
			});
		} else {
			await userRepository.create(input);
		}
		setEditing(undefined);
		await load();
	};

	if (error) return <Alert tone="error">{error}</Alert>;
	if (!users) return <LoadingState />;

	return (
		<>
			<section className="panel user-intro">
				<PanelHeader
					title="Tài khoản và phân quyền"
					description="Mỗi người chỉ mở được thẻ đã tick, và chỉ thấy phiếu do chính mình nhập."
					icon={<UsersRound size={17} />}
					actions={
						<button
							type="button"
							className="button primary"
							onClick={() => setEditing(null)}
						>
							<Plus size={15} /> Thêm người dùng
						</button>
					}
				/>
			</section>

			<Panel
				title="Danh sách người dùng"
				subtitle={`${users.length} tài khoản`}
			>
				<div className="table-scroll user-table-wrap">
					<table className="user-table">
						<thead>
							<tr>
								<th>Người dùng</th>
								<th>Vai trò</th>
								<th>Thẻ được truy cập</th>
								<th>Trạng thái</th>
								<th>Thao tác</th>
							</tr>
						</thead>
						<tbody>
							{users.map((user) => (
								<tr key={user.id}>
									<td>
										<strong>{user.fullName}</strong>
										<span className="cell-meta">{user.username}</span>
									</td>
									<td>
										<StatusPill tone={user.isAdmin ? "info" : "neutral"}>
											{user.isAdmin ? "Quản trị viên" : "Nhân viên"}
										</StatusPill>
									</td>
									<td>
										{user.isAdmin ? (
											<span className="cell-meta">Toàn quyền</span>
										) : user.pages.length === 0 ? (
											<span className="cell-meta">Chưa cấp thẻ nào</span>
										) : (
											<div className="inline-actions">
												{user.pages.map((key) => (
													<StatusPill tone="success" key={key}>
														{labelOf(key)}
													</StatusPill>
												))}
											</div>
										)}
									</td>
									<td>
										<StatusPill tone={user.isActive ? "success" : "danger"}>
											{user.isActive ? "Đang dùng" : "Đã khóa"}
										</StatusPill>
									</td>
									<td>
										<div className="inline-actions">
											{!user.isAdmin && (
												<button
													type="button"
													className="row-action"
													title="Sửa người dùng"
													onClick={() => setEditing(user)}
												>
													<Pencil size={14} />
												</button>
											)}
											<button
												type="button"
												className="row-action"
												title="Đặt lại mật khẩu"
												onClick={() => setResetting(user)}
											>
												<KeyRound size={14} />
											</button>
											{user.id !== currentUser.id && (
												<button
													type="button"
													className="row-action"
													title={
														user.isActive
															? "Khóa tài khoản"
															: "Mở khóa tài khoản"
													}
													onClick={async () => {
														try {
															await userRepository.update(user.id, {
																isActive: !user.isActive,
															});
															await load();
														} catch (cause) {
															setError(
																cause instanceof Error
																	? cause.message
																	: "Không cập nhật được tài khoản.",
															);
														}
													}}
												>
													{user.isActive ? (
														<Lock size={14} />
													) : (
														<Unlock size={14} />
													)}
												</button>
											)}
											{!user.isAdmin && user.id !== currentUser.id && (
												<button
													type="button"
													className="row-action user-delete-action"
													title="Xóa tài khoản"
													onClick={() => setDeleting(user)}
												>
													<Trash2 size={14} />
												</button>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Panel>

			{editing !== undefined && (
				<UserDialog
					user={editing}
					grantable={grantable}
					onSave={save}
					onClose={() => setEditing(undefined)}
				/>
			)}

			{resetting && (
				<PasswordDialog
					user={resetting}
					onSave={async (password) => {
						await userRepository.resetPassword(resetting.id, password);
						setResetting(null);
					}}
					onClose={() => setResetting(null)}
				/>
			)}

			{deleting && (
				<Dialog
					title="Xóa tài khoản nhân viên"
					subtitle={`Xóa tài khoản ${deleting.fullName} (${deleting.username})? Thao tác này không thể hoàn tác.`}
					confirmLabel="Xóa tài khoản"
					confirmClassName="danger"
					onConfirm={async () => {
						await userRepository.remove(deleting.id);
						setDeleting(null);
						await load();
					}}
					onClose={() => setDeleting(null)}
				>
					<p className="user-delete-note">
						Chỉ xóa được tài khoản chưa phát sinh dữ liệu. Với tài khoản đã có
						dữ liệu, hãy dùng chức năng khóa để giữ lịch sử.
					</p>
				</Dialog>
			)}
		</>
	);
}
