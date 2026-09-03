import { api } from "../../shared/api/client";
import type {
	CreateUserInput,
	GrantablePage,
	ManagedUser,
	UpdateUserInput,
} from "./user.model";

export const userRepository = {
	async list(): Promise<ManagedUser[]> {
		const { items } = await api<{ items: ManagedUser[] }>("GET", "/api/users");
		return items;
	},

	/** Danh sách thẻ có thể cấp — dùng để vẽ các ô tick. */
	async grantablePages(): Promise<GrantablePage[]> {
		const { pages } = await api<{ pages: GrantablePage[] }>(
			"GET",
			"/api/pages",
		);
		return pages;
	},

	create(input: CreateUserInput): Promise<ManagedUser> {
		return api<ManagedUser>("POST", "/api/users", input);
	},

	update(id: number, input: UpdateUserInput): Promise<ManagedUser> {
		return api<ManagedUser>("PATCH", `/api/users/${id}`, input);
	},

	resetPassword(id: number, password: string): Promise<{ ok: true }> {
		return api<{ ok: true }>("POST", `/api/users/${id}/password`, { password });
	},
};
