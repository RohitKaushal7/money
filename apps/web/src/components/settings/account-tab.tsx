import { Button } from "@money/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Laptop, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Field, Section, TextInput } from "@/components/settings/section";
import { authClient } from "@/lib/auth-client";

export function AccountTab() {
	return (
		<>
			<Profile />
			<Sessions />
		</>
	);
}

/**
 * Your name, and your email read-only.
 *
 * Email is deliberately not editable. Better-Auth's `changeEmail` sends a verification mail to the current
 * address, and there is no mail sender wired up — an editable field would either silently do nothing or
 * strand you on an address you can't confirm. An admin can change it for you instead.
 */
function Profile() {
	const { data: session } = authClient.useSession();
	const qc = useQueryClient();
	const user = session?.user;
	const [draft, setDraft] = useState<string | null>(null);
	const name = draft ?? user?.name ?? "";
	const dirty = draft != null && draft.trim() !== "" && draft !== user?.name;

	const save = useMutation({
		mutationFn: async () => {
			const res = await authClient.updateUser({ name: name.trim() });
			if (res.error) throw new Error(res.error.message ?? "Couldn't save");
		},
		onSuccess: async () => {
			setDraft(null);
			await qc.invalidateQueries();
			toast.success("Name updated.");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<Section title="Profile">
			<form
				className="flex flex-wrap items-end gap-3"
				onSubmit={(e) => {
					e.preventDefault();
					if (dirty) save.mutate();
				}}
			>
				<Field label="Name">
					<TextInput
						value={name}
						onChange={(e) => setDraft(e.target.value)}
						className="w-56"
					/>
				</Field>
				<Field label="Email">
					<div className="flex h-[34px] w-64 items-center rounded-md border border-border border-dashed bg-muted/40 px-2 text-muted-foreground text-sm">
						{user?.email ?? "—"}
					</div>
				</Field>
				<Button type="submit" size="sm" disabled={!dirty || save.isPending}>
					{save.isPending ? "Saving…" : "Save"}
				</Button>
			</form>
			<p className="text-muted-foreground text-xs">
				Email can't be changed here — there's no verification mail to send. Ask
				an admin.
			</p>
		</Section>
	);
}

/** "Chrome on Linux" out of a user-agent string. Best-effort: it's a label, not a security control. */
function describeDevice(ua: string | null | undefined): {
	label: string;
	mobile: boolean;
} {
	if (!ua) return { label: "Unknown device", mobile: false };
	const browser = /Edg\//.test(ua)
		? "Edge"
		: /OPR\//.test(ua)
			? "Opera"
			: /Firefox\//.test(ua)
				? "Firefox"
				: /Chrome\//.test(ua)
					? "Chrome"
					: /Safari\//.test(ua)
						? "Safari"
						: "Browser";
	const mobile = /Android|iPhone|iPad|Mobile/.test(ua);
	const os = /Android/.test(ua)
		? "Android"
		: /iPhone|iPad|iOS/.test(ua)
			? "iOS"
			: /Windows/.test(ua)
				? "Windows"
				: /Mac OS X/.test(ua)
					? "macOS"
					: /Linux/.test(ua)
						? "Linux"
						: "";
	return { label: os ? `${browser} on ${os}` : browser, mobile };
}

/**
 * Every device holding a live session, with a way to end each one.
 *
 * The point isn't housekeeping — it's the "did I leave myself signed in on someone else's machine?"
 * question, which you can only answer by seeing the list.
 */
function Sessions() {
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();
	const qc = useQueryClient();

	const q = useQuery({
		queryKey: ["auth", "sessions"],
		queryFn: async () => {
			const res = await authClient.listSessions();
			if (res.error) throw new Error(res.error.message ?? "Couldn't load");
			return res.data ?? [];
		},
	});

	const revoke = useMutation({
		mutationFn: async (token: string) => {
			const res = await authClient.revokeSession({ token });
			if (res.error) throw new Error(res.error.message ?? "Couldn't sign out");
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
			toast.success("Signed that device out.");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const signOut = useMutation({
		mutationFn: async () => {
			await authClient.signOut();
		},
		onSuccess: () => navigate({ to: "/login" }),
	});

	const rows = q.data ?? [];
	const currentToken = session?.session.token;

	return (
		<Section
			title="Sessions"
			action={
				<Button
					variant="outline"
					size="sm"
					disabled={signOut.isPending}
					onClick={() => signOut.mutate()}
				>
					Sign out
				</Button>
			}
		>
			{q.isPending ? (
				<p className="text-muted-foreground text-sm">Loading…</p>
			) : rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">No other sessions.</p>
			) : (
				<ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
					{rows.map((s) => {
						const { label, mobile } = describeDevice(s.userAgent);
						const isCurrent = s.token === currentToken;
						const Icon = mobile ? Smartphone : Laptop;
						return (
							<li
								key={s.id}
								className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm"
							>
								<Icon className="size-4 shrink-0 text-muted-foreground" />
								<span className="font-medium">{label}</span>
								{isCurrent && (
									<span className="rounded-full bg-[var(--covered)]/15 px-2 py-0.5 text-[0.7rem] text-[var(--covered)]">
										this device
									</span>
								)}
								<span className="tnum ml-auto text-muted-foreground text-xs">
									expires {new Date(s.expiresAt).toLocaleDateString()}
								</span>
								{!isCurrent && (
									<Button
										variant="ghost"
										size="xs"
										disabled={revoke.isPending}
										onClick={() => revoke.mutate(s.token)}
									>
										Sign out
									</Button>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</Section>
	);
}
