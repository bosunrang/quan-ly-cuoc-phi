import {
	MapPinned,
	Pencil,
	Plus,
	Search,
	Trash2,
	User,
	UserCheck,
	UserRoundCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	type Employee,
	type EmployeeInput,
	type EmployeeListResult,
	emptyEmployeeInput,
	toEmployeeInput,
} from "../../domain/employees/employee.model";
import { employeeRepository } from "../../domain/employees/employee.repository";
import type { ManagedUser } from "../../domain/users/user.model";
import { userRepository } from "../../domain/users/user.repository";
import { Alert } from "../../shared/ui/Alert";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { EmptyState, LoadingState } from "../../shared/ui/Panel";
import { StatusPill } from "../../shared/ui/StatusPill";
import { EmployeeDialog } from "./components/EmployeeDialog";

interface EditorState {
	initial: EmployeeInput;
	editingId: number | null;
}

export function EmployeesPage() {
	const [data, setData] = useState<EmployeeListResult | null>(null);
	const [users, setUsers] = useState<ManagedUser[]>([]);
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");
	const [editor, setEditor] = useState<EditorState | null>(null);
	const [removing, setRemoving] = useState<Employee | null>(null);
	const [error, setError] = useState<string | null>(null);
	const loadEmployees = useCallback(async () => {
		try {
			const employees = await employeeRepository.list(search);
			setData(employees);
			setError(null);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Không tải được nhân viên.",
			);
		}
	}, [search]);
	useEffect(() => {
		void loadEmployees();
	}, [loadEmployees]);
	useEffect(() => {
		void userRepository
			.list()
			.then(setUsers)
			.catch(() => setUsers([]));
	}, []);
	useEffect(() => {
		const timer = window.setTimeout(() => setSearch(searchInput), 220);
		return () => window.clearTimeout(timer);
	}, [searchInput]);
	const save = async (input: EmployeeInput) => {
		if (editor?.editingId)
			await employeeRepository.update(editor.editingId, input);
		else await employeeRepository.create(input);
		setEditor(null);
		await loadEmployees();
	};
	if (!data)
		return error ? <Alert tone="error">{error}</Alert> : <LoadingState />;
	return (
		<>
			<section className="panel employee-intro">
				<div className="employee-intro-icon">
					<UserRoundCheck size={22} />
				</div>
				<div>
					<h2>Dữ liệu nhân viên</h2>
					<p>Quản lý nhân sự phụ trách khu vực và tài khoản làm việc.</p>
				</div>
				<button
					className="button primary"
					type="button"
					onClick={() =>
						setEditor({ initial: emptyEmployeeInput(), editingId: null })
					}
				>
					<Plus size={16} /> Thêm nhân viên
				</button>
			</section>
			{error && <Alert tone="error">{error}</Alert>}
			<section
				className="stat-overview employee-overview"
				aria-label="Tổng quan nhân viên"
			>
				<article>
					<div className="stat-icon neutral">
						<User size={18} />
					</div>
					<span>Tổng nhân viên</span>
					<strong>{data.count}</strong>
				</article>
				<article>
					<div className="stat-icon success">
						<UserCheck size={18} />
					</div>
					<span>Đang hoạt động</span>
					<strong>{data.activeCount}</strong>
				</article>
				<article>
					<div className="stat-icon info">
						<MapPinned size={18} />
					</div>
					<span>Có địa chỉ</span>
					<strong>{data.addressCount}</strong>
				</article>
				<article>
					<div className="stat-icon warning">
						<UserRoundCheck size={18} />
					</div>
					<span>Đã liên kết tài khoản</span>
					<strong>{data.linkedUserCount}</strong>
				</article>
			</section>
			<section className="panel employee-data-panel">
				<div className="employee-toolbar">
					<label>
						<span>Tìm nhân viên</span>
						<div>
							<Search size={16} />
							<input
								value={searchInput}
								onChange={(event) => setSearchInput(event.target.value)}
								placeholder="Nhập họ tên hoặc khu vực..."
							/>
						</div>
					</label>
					<strong>{data.items.length} nhân viên</strong>
				</div>
				{data.items.length === 0 ? (
					<EmptyState>
						Chưa có nhân viên nào. Bấm “Thêm nhân viên” để bắt đầu.
					</EmptyState>
				) : (
					<div className="table-scroll">
						<table className="employee-table">
							<thead>
								<tr>
									<th>STT</th>
									<th>Họ tên</th>
									<th>Địa chỉ</th>
									<th>Tài khoản liên kết</th>
									<th>Trạng thái</th>
									<th>Thao tác</th>
								</tr>
							</thead>
							<tbody>
								{data.items.map((employee, index) => (
									<tr key={employee.id}>
										<td>{index + 1}</td>
										<td>
											<strong>{employee.fullName}</strong>
										</td>
										<td>{employee.address || "—"}</td>
										<td>
											{employee.linkedUsername ? (
												<span className="employee-account">
													@{employee.linkedUsername}
												</span>
											) : (
												"—"
											)}
										</td>
										<td>
											<StatusPill
												tone={employee.isActive ? "success" : "neutral"}
											>
												{employee.isActive ? "Đang hoạt động" : "Tạm ngưng"}
											</StatusPill>
										</td>
										<td>
											<div className="inline-actions">
												<button
													className="row-action"
													type="button"
													title="Sửa nhân viên"
													onClick={() =>
														setEditor({
															initial: toEmployeeInput(employee),
															editingId: employee.id,
														})
													}
												>
													<Pencil size={14} />
												</button>
												<button
													className="row-action is-danger"
													type="button"
													title="Xóa nhân viên"
													onClick={() => setRemoving(employee)}
												>
													<Trash2 size={14} />
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
			{editor && (
				<EmployeeDialog
					initial={editor.initial}
					editingId={editor.editingId}
					users={users}
					onSave={save}
					onClose={() => setEditor(null)}
				/>
			)}
			{removing && (
				<ConfirmDialog
					title="Xóa nhân viên"
					message={`Xóa “${removing.fullName}” khỏi danh sách nhân viên?`}
					onConfirm={async () => {
						await employeeRepository.remove(removing.id);
						setRemoving(null);
						await loadEmployees();
					}}
					onClose={() => setRemoving(null)}
				/>
			)}
		</>
	);
}
