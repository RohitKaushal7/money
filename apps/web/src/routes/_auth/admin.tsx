import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/admin")({
	component: AdminPage,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		const role = (session.data?.user as { role?: string } | undefined)?.role;
		if (role !== "admin") {
			throw redirect({ to: "/" });
		}
	},
});

const USERS_KEY = ["admin", "users"] as const;

/** A throwaway share-once password, mirroring the CLI's random fallback. */
function genPassword(): string {
	return Math.random().toString(36).slice(2, 12);
}

function AdminPage() {
	const { data: session } = authClient.useSession();
	const selfId = session?.user.id;
	const qc = useQueryClient();
	const invalidate = () => qc.invalidateQueries({ queryKey: USERS_KEY });

	const usersQuery = useQuery({
		queryKey: USERS_KEY,
		queryFn: async () => {
			const res = await authClient.admin.listUsers({ query: { limit: 100 } });
			if (res.error || !res.data) {
				throw new Error(res.error?.message ?? "Failed to list users");
			}
			return res.data.users;
		},
	});

	const setBanned = useMutation({
		mutationFn: async ({
			userId,
			banned,
		}: {
			userId: string;
			banned: boolean;
		}) => {
			const res = banned
				? await authClient.admin.banUser({ userId })
				: await authClient.admin.unbanUser({ userId });
			if (res.error) {
				throw new Error(res.error.message ?? "Failed");
			}
			return res.data;
		},
		onSuccess: invalidate,
		onError: (e: Error) => toast.error(e.message),
	});

	const removeUser = useMutation({
		mutationFn: async (userId: string) => {
			const res = await authClient.admin.removeUser({ userId });
			if (res.error) {
				throw new Error(res.error.message ?? "Failed to delete user");
			}
			return res.data;
		},
		onSuccess: () => {
			invalidate();
			toast.success("User and their data removed");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const retag = useMutation({
		...orpc.admin.retagUser.mutationOptions(),
		onSuccess: (d) =>
			d.ok
				? toast.success("Re-tagged their ledger")
				: toast.error("Re-tag finished with issues"),
		onError: (e: Error) => toast.error(e.message),
	});

	const users = usersQuery.data ?? [];

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-wrap items-end justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h1 className="flex items-center gap-2 font-display font-medium text-3xl tracking-tight">
							<ShieldCheck className="size-6 text-muted-foreground" />
							Admin
						</h1>
						<p className="text-muted-foreground">
							Invite friends, disable or remove them, and fix a stuck ledger.
						</p>
					</div>
					<dl className="flex gap-6 text-sm">
						<div className="flex flex-col items-end">
							<dd className="tnum font-display font-medium text-2xl">
								{users.length}
							</dd>
							<dt className="text-muted-foreground text-xs">Users</dt>
						</div>
					</dl>
				</header>

				<CreateUser onCreated={invalidate} />

				<section className="flex flex-col gap-4">
					<h2 className="border-border border-b-2 pb-2 font-display font-medium text-xl">
						Users
					</h2>
					{usersQuery.isPending ? (
						<p className="text-muted-foreground text-sm">Loading…</p>
					) : users.length === 0 ? (
						<p className="text-muted-foreground text-sm">No users yet.</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full min-w-[40rem] border-collapse text-sm">
								<thead>
									<tr className="border-border border-b text-left text-muted-foreground text-xs uppercase tracking-wider">
										<th className="py-2 pr-3 font-medium">User</th>
										<th className="py-2 pr-3 font-medium">Role</th>
										<th className="py-2 pr-3 font-medium">Status</th>
										<th className="py-2 pr-3 font-medium">Joined</th>
										<th className="py-2 pr-3 text-right font-medium">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border">
									{users.map((u) => {
										const role = (u as { role?: string | null }).role ?? "user";
										const banned = Boolean(
											(u as { banned?: boolean | null }).banned,
										);
										const isSelf = u.id === selfId;
										return (
											<tr key={u.id} className="align-middle">
												<td className="py-3 pr-3">
													<div className="flex flex-col">
														<span className="font-medium">
															{u.name}
															{isSelf && (
																<span className="ml-2 text-muted-foreground text-xs">
																	(you)
																</span>
															)}
														</span>
														<span className="text-muted-foreground text-xs">
															{u.email}
														</span>
													</div>
												</td>
												<td className="py-3 pr-3">
													<span className="text-xs">{role}</span>
												</td>
												<td className="py-3 pr-3">
													{banned ? (
														<span className="rounded-full bg-[var(--uncovered)]/15 px-2 py-0.5 text-[var(--uncovered)] text-xs">
															disabled
														</span>
													) : (
														<span className="rounded-full bg-[var(--covered)]/15 px-2 py-0.5 text-[var(--covered)] text-xs">
															active
														</span>
													)}
												</td>
												<td className="tnum py-3 pr-3 text-muted-foreground text-xs">
													{new Date(u.createdAt).toLocaleDateString()}
												</td>
												<td className="py-3 pr-3">
													<div className="flex items-center justify-end gap-1.5">
														<Button
															variant="ghost"
															size="xs"
															disabled={retag.isPending}
															onClick={() => retag.mutate({ uid: u.id })}
															title="Re-tag their ledger"
														>
															<RefreshCw className="size-3" />
															Re-tag
														</Button>
														{!isSelf && (
															<Button
																variant="outline"
																size="xs"
																disabled={setBanned.isPending}
																onClick={() =>
																	setBanned.mutate({
																		userId: u.id,
																		banned: !banned,
																	})
																}
															>
																{banned ? "Enable" : "Disable"}
															</Button>
														)}
														{!isSelf && (
															<DeleteButton
																pending={removeUser.isPending}
																onConfirm={() => removeUser.mutate(u.id)}
															/>
														)}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>
		</main>
	);
}

/** Two-click inline delete — no blocking browser dialog; warns it destroys their data. */
function DeleteButton({
	pending,
	onConfirm,
}: {
	pending: boolean;
	onConfirm: () => void;
}) {
	const [armed, setArmed] = useState(false);
	if (!armed) {
		return (
			<Button
				variant="ghost"
				size="xs"
				title="Delete user + their data"
				onClick={() => setArmed(true)}
			>
				<Trash2 className="size-3" />
			</Button>
		);
	}
	return (
		<div className="flex items-center gap-1">
			<span className="text-muted-foreground text-xs">Delete + all data?</span>
			<Button
				variant="destructive"
				size="xs"
				disabled={pending}
				onClick={() => {
					onConfirm();
					setArmed(false);
				}}
			>
				Confirm
			</Button>
			<Button variant="ghost" size="xs" onClick={() => setArmed(false)}>
				Cancel
			</Button>
		</div>
	);
}

/** Invite a friend. Blank password → a random share-once temp shown on success. */
function CreateUser({ onCreated }: { onCreated: () => void }) {
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [role, setRole] = useState<"user" | "admin">("user");
	const [password, setPassword] = useState("");

	const create = useMutation({
		mutationFn: async (input: {
			email: string;
			name: string;
			role: "user" | "admin";
			password: string;
		}) => {
			const res = await authClient.admin.createUser(input);
			if (res.error) {
				throw new Error(res.error.message ?? "Create failed");
			}
			return res.data;
		},
		onSuccess: (_d, vars) => {
			onCreated();
			toast.success(`Invited ${vars.email}`, {
				description: `Temp password: ${vars.password} — share it on the call.`,
				duration: 30000,
			});
			setEmail("");
			setName("");
			setRole("user");
			setPassword("");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<section className="flex flex-col gap-4">
			<h2 className="border-border border-b-2 pb-2 font-display font-medium text-xl">
				Invite a user
			</h2>
			<form
				className="flex flex-wrap items-end gap-3"
				onSubmit={(e) => {
					e.preventDefault();
					if (!email || !name) {
						toast.error("Email and name are required");
						return;
					}
					create.mutate({
						email,
						name,
						role,
						password: password || genPassword(),
					});
				}}
			>
				<label className="flex flex-col gap-1 text-xs">
					<span className="text-muted-foreground">Email</span>
					<Input
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="friend@example.com"
						className="w-56"
					/>
				</label>
				<label className="flex flex-col gap-1 text-xs">
					<span className="text-muted-foreground">Name</span>
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Asha"
						className="w-40"
					/>
				</label>
				<label className="flex flex-col gap-1 text-xs">
					<span className="text-muted-foreground">Role</span>
					<select
						value={role}
						onChange={(e) => setRole(e.target.value as "user" | "admin")}
						className="h-8 rounded-none border border-input bg-transparent px-2.5 text-xs outline-none focus-visible:border-ring dark:bg-input/30"
					>
						<option value="user">user</option>
						<option value="admin">admin</option>
					</select>
				</label>
				<label className="flex flex-col gap-1 text-xs">
					<span className="text-muted-foreground">Password (optional)</span>
					<Input
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="random if blank"
						className="w-44"
					/>
				</label>
				<Button type="submit" disabled={create.isPending}>
					{create.isPending ? "Inviting…" : "Invite"}
				</Button>
			</form>
		</section>
	);
}
