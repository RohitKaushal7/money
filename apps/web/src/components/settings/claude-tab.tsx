import { Button } from "@money/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ArmedDelete } from "@/components/armed-delete";
import { Field, Section, TextInput } from "@/components/settings/section";
import { useIsAdmin } from "@/components/sidebar";
import { useMoney } from "@/lib/currency";
import { formatRate, formatRelativeTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export function ClaudeTab() {
	return (
		<>
			<Tokens />
			<RecentChanges />
		</>
	);
}

type Scope = "read" | "read_write";

const SCOPE_LABEL: Record<Scope, string> = {
	read: "Read only",
	read_write: "Read and write",
};

const asMs = (d: Date | string | number | null | undefined) =>
	d == null ? null : new Date(d).getTime();

const day = (d: Date | string | number) =>
	new Date(d).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});

/** A copy-to-clipboard button that says it worked. Clipboard access can be refused, so that is a toast too. */
function CopyButton({ text, label }: { text: string; label: string }) {
	const [done, setDone] = useState(false);
	return (
		<Button
			type="button"
			size="sm"
			variant="outline"
			aria-label={label}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text);
					setDone(true);
					setTimeout(() => setDone(false), 1500);
				} catch {
					toast.error("Couldn't copy — select the text and copy it by hand.");
				}
			}}
		>
			{done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
			{done ? "Copied" : "Copy"}
		</Button>
	);
}

function Tokens() {
	const qc = useQueryClient();
	const list = useQuery(orpc.tokens.list.queryOptions());
	const isAdmin = useIsAdmin();

	const [name, setName] = useState("");
	const [scope, setScope] = useState<Scope>("read");
	const [expires, setExpires] = useState("");
	/** Plaintext of the token just made. Lives only in this component's state: it is never fetched again. */
	const [fresh, setFresh] = useState<string | null>(null);

	const create = useMutation({
		...orpc.tokens.create.mutationOptions(),
		onSuccess: (r) => {
			setFresh(r.token);
			setName("");
			setExpires("");
			qc.invalidateQueries();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const revoke = useMutation({
		...orpc.tokens.revoke.mutationOptions(),
		onSuccess: (r) => {
			if (r.ok) toast.success("Token revoked.");
			else toast.error("That token was not found or is already revoked.");
			qc.invalidateQueries();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const canCreate = name.trim().length > 0 && !create.isPending;
	const command = (token: string) =>
		`claude mcp add --transport http money ${window.location.origin}/mcp --header "Authorization: Bearer ${token}"`;

	return (
		<Section title="Tokens">
			<div className="flex max-w-lg flex-col gap-2 text-muted-foreground text-sm">
				<p>
					A token lets Claude Code read your data. With write access it can
					change anything you can change in the app. Only changes to holdings
					and recurring expenses can be undone. Make one per tool, and revoke it
					when you stop using it.
				</p>
				{isAdmin && (
					<p>
						You're an admin, so a write token can also change the currencies and
						exchange rates that every user of this install shares.
					</p>
				)}
			</div>

			<form
				className="flex flex-col gap-3"
				onSubmit={(e) => {
					e.preventDefault();
					if (!canCreate) return;
					create.mutate({
						name: name.trim(),
						scope,
						// Valid through the end of the chosen day, in the owner's timezone.
						expiresAt: expires ? new Date(`${expires}T23:59:59`) : undefined,
					});
				}}
			>
				<div className="flex flex-wrap items-end gap-3">
					<Field label="Name">
						<TextInput
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Laptop Claude Code"
							maxLength={80}
							className="w-full sm:w-56"
						/>
					</Field>
					<Field label="Expires (optional)">
						<TextInput
							type="date"
							value={expires}
							onChange={(e) => setExpires(e.target.value)}
						/>
					</Field>
				</div>
				<fieldset className="flex flex-wrap gap-x-5 gap-y-2">
					<legend className="sr-only">Access</legend>
					{(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
						<label key={s} className="flex items-center gap-2 text-sm">
							<input
								type="radio"
								name="token-scope"
								checked={scope === s}
								onChange={() => setScope(s)}
							/>
							{SCOPE_LABEL[s]}
						</label>
					))}
				</fieldset>
				<div>
					<Button type="submit" size="sm" disabled={!canCreate}>
						{create.isPending ? "Creating…" : "Create token"}
					</Button>
				</div>
			</form>

			{fresh && (
				<div className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/40 p-4">
					<p className="font-medium text-sm">You won't see this token again.</p>
					<div className="flex flex-col gap-1.5">
						<span className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">
							Token
						</span>
						<code className="break-all rounded-md border border-border bg-background px-2 py-1.5 text-xs">
							{fresh}
						</code>
						<div>
							<CopyButton text={fresh} label="Copy token" />
						</div>
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">
							Add it to Claude Code
						</span>
						<code className="break-all rounded-md border border-border bg-background px-2 py-1.5 text-xs">
							{command(fresh)}
						</code>
						<div>
							<CopyButton text={command(fresh)} label="Copy command" />
						</div>
					</div>
					<div>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => {
								setFresh(null);
								// The mutation keeps its result too; drop it so the token is gone from memory.
								create.reset();
							}}
						>
							I've saved it
						</Button>
					</div>
				</div>
			)}

			{list.data && list.data.length === 0 && (
				<p className="text-muted-foreground text-sm">No tokens yet.</p>
			)}
			{list.data && list.data.length > 0 && (
				<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
					{list.data.map((t) => {
						const revoked = t.revokedAt != null;
						const expiresMs = asMs(t.expiresAt);
						const expired = expiresMs != null && expiresMs < Date.now();
						return (
							<li
								key={t.id}
								className={`flex items-start justify-between gap-3 px-4 py-3 ${revoked ? "opacity-50" : ""}`}
							>
								<div className="flex min-w-0 flex-col gap-0.5">
									<div className="flex flex-wrap items-center gap-x-2">
										<span className="break-words font-medium text-sm">
											{t.name}
										</span>
										<span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
											{SCOPE_LABEL[t.scope]}
										</span>
										{revoked && (
											<span className="text-[var(--uncovered)] text-xs">
												revoked
											</span>
										)}
										{!revoked && expired && (
											<span className="text-[var(--uncovered)] text-xs">
												expired
											</span>
										)}
									</div>
									<span className="tnum break-all text-muted-foreground text-xs">
										{t.prefix}…
									</span>
									<span className="text-muted-foreground text-xs">
										Created {formatRelativeTime(asMs(t.createdAt))} · Last used{" "}
										{t.lastUsedAt
											? formatRelativeTime(asMs(t.lastUsedAt))
											: "never"}
										{expiresMs != null && !revoked && !expired
											? ` · Expires ${day(expiresMs)}`
											: ""}
									</span>
								</div>
								{!revoked && (
									<ArmedDelete
										size="sm"
										label="Revoke"
										title="Revoke token"
										disabled={revoke.isPending}
										onConfirm={() => revoke.mutate({ id: t.id })}
										className="shrink-0"
									/>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</Section>
	);
}

const PROCEDURE_WORDS: Record<string, string> = {
	"plan.addInvestment": "Added a holding",
	"plan.updateInvestment": "Edited a holding",
	"plan.deleteInvestment": "Deleted a holding",
	"plan.addRecurring": "Added a recurring expense",
	"plan.updateRecurring": "Edited a recurring expense",
	"plan.deleteRecurring": "Deleted a recurring expense",
	"changes.undo": "Undid a change",
	"networth.logToday": "Logged today's net worth",
	"networth.add": "Added a net-worth entry",
	"networth.remove": "Removed a net-worth entry",
	"categories.create": "Added a category",
	"categories.update": "Edited a category",
	"categories.remove": "Removed a category",
	"categories.reorder": "Reordered categories",
	"rules.create": "Added a rule",
	"rules.update": "Edited a rule",
	"rules.remove": "Removed a rule",
	"rules.reorder": "Reordered rules",
	"overrides.set": "Recategorised a transaction",
	"overrides.clear": "Cleared a recategorisation",
	"splits.set": "Split a transaction",
	"splits.clear": "Cleared a split",
	"tax.setKpiConfig": "Changed the after-tax KPI",
	"tax.upsert": "Saved a tax profile",
	"tax.finalize": "Finalised a tax year",
	"currency.setDisplay": "Changed the display currency",
};

const procedureInWords = (path: string) => PROCEDURE_WORDS[path] ?? path;

const FIELD_LABEL: Record<string, string> = {
	name: "Name",
	type: "Type",
	platform: "Platform",
	group: "Group",
	principal: "Principal",
	annual_rate: "Rate",
	current_value: "Current value",
	expected_monthly_interest: "Monthly interest",
	interest_cadence: "Interest cadence",
	payout: "Payout",
	start_date: "Start",
	maturity_date: "Maturity",
	end_date: "End",
	action_on_maturity: "On maturity",
	status: "Status",
	active: "Active",
	is_passive_income_source: "Passive income",
	currency: "Currency",
	notes: "Notes",
	category: "Category",
	amount: "Amount",
	cadence: "Cadence",
};

const MONEY_FIELDS = new Set([
	"principal",
	"current_value",
	"expected_monthly_interest",
	"amount",
]);
const BOOLEAN_FIELDS = new Set(["active", "is_passive_income_source"]);
const SKIPPED_FIELDS = new Set(["updated_at", "created_at"]);

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const labelOf = (key: string) =>
	FIELD_LABEL[key] ??
	key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function ChangedFields({ before, after }: { before: unknown; after: unknown }) {
	const m = useMoney();
	const b = isRow(before) ? before : {};
	const a = isRow(after) ? after : {};
	const currency = String(a.currency ?? b.currency ?? "INR");

	const show = (key: string, v: unknown): string => {
		if (v == null || v === "") return "—";
		if (key === "annual_rate" && typeof v === "number") return formatRate(v);
		if (MONEY_FIELDS.has(key) && typeof v === "number")
			return m.fmtNative(v, currency);
		if (typeof v === "boolean") return v ? "yes" : "no";
		// SQLite stores booleans as 0/1 and the raw rows are shown as stored.
		if (BOOLEAN_FIELDS.has(key)) return v ? "yes" : "no";
		if (typeof v === "object") return JSON.stringify(v);
		const s = String(v);
		return s.length > 60 ? `${s.slice(0, 57)}…` : s;
	};

	const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
		(k) => !SKIPPED_FIELDS.has(k) && k !== "id",
	);
	// An update lists only what moved; an add or a delete has nothing to compare, so it names the row.
	const both = isRow(before) && isRow(after);
	const lines = both
		? keys
				.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
				.map((k) => `${labelOf(k)}: ${show(k, b[k])} → ${show(k, a[k])}`)
		: [];
	const named = String((isRow(after) ? after : b).name ?? "");

	if (!both) {
		return named ? (
			<span className="break-words text-muted-foreground text-xs">{named}</span>
		) : null;
	}
	return (
		<ul className="flex flex-col gap-0.5 text-muted-foreground text-xs">
			{named && <li className="break-words font-medium">{named}</li>}
			{lines.map((l) => (
				<li key={l} className="tnum break-words">
					{l}
				</li>
			))}
		</ul>
	);
}

function RecentChanges() {
	const qc = useQueryClient();
	const q = useQuery(orpc.changes.list.queryOptions({ input: { limit: 50 } }));

	const undo = useMutation({
		...orpc.changes.undo.mutationOptions(),
		onSuccess: () => toast.success("Change undone."),
		// A refused undo (edited since, already undone) is an error carrying the reason.
		onError: (e: Error) => toast.error(e.message),
		onSettled: () => qc.invalidateQueries(),
	});

	return (
		<Section title="Recent changes">
			<p className="max-w-lg text-muted-foreground text-sm">
				The last 50 writes to your data, from the app and from Claude. Edits to
				holdings and recurring expenses can be undone.
			</p>
			{q.data && q.data.length === 0 && (
				<p className="text-muted-foreground text-sm">Nothing changed yet.</p>
			)}
			{q.data && q.data.length > 0 && (
				<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
					{q.data.map((c) => {
						const undone = c.undoneAt != null;
						const undoable = c.entity != null && !undone;
						return (
							<li
								key={c.id}
								className="flex items-start justify-between gap-3 px-4 py-3"
							>
								<div
									className={`flex min-w-0 flex-col gap-0.5 ${undone ? "opacity-50" : ""}`}
								>
									<span className="font-medium text-sm">
										{procedureInWords(c.procedure)}
										{undone && (
											<span className="ml-2 font-normal text-muted-foreground text-xs">
												undone
											</span>
										)}
									</span>
									<span
										className="text-muted-foreground text-xs"
										title={new Date(c.at).toLocaleString()}
									>
										{formatRelativeTime(asMs(c.at))} ·{" "}
										{c.source === "mcp"
											? `Claude · ${c.tokenName ?? "token"}`
											: "App"}
									</span>
									{c.entity && (
										<ChangedFields before={c.before} after={c.after} />
									)}
								</div>
								{undoable && (
									<Button
										type="button"
										size="sm"
										variant="outline"
										className="shrink-0"
										disabled={undo.isPending}
										onClick={() => undo.mutate({ id: c.id })}
									>
										Undo
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
