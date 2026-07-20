import type {
	AmountMode,
	StatementAnchor,
	StatementMapping,
} from "@money/shared";
import { splitCsvHeader, validateStatementMapping } from "@money/shared";
import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { Select } from "@money/ui/components/select";
import { Textarea } from "@money/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	CheckCircle2,
	FileText,
	Trash2,
	TriangleAlert,
	Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDay } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/import")({
	component: ImportPage,
});

const IN = "var(--covered)";
const WARN = "oklch(0.74 0.15 66)";
const tint = (c: string, pct: number) =>
	`color-mix(in oklab, ${c} ${pct}%, transparent)`;

const NEW_ACCOUNT = "__new__";

const DATE_FORMATS = [
	{ value: "%d/%m/%Y", label: "31/12/2026 (dd/mm/yyyy)" },
	{ value: "%d-%m-%Y", label: "31-12-2026 (dd-mm-yyyy)" },
	{ value: "%Y-%m-%d", label: "2026-12-31 (yyyy-mm-dd)" },
	{ value: "%d/%m/%y", label: "31/12/26 (dd/mm/yy)" },
	{ value: "%d-%b-%Y", label: "31-Dec-2026 (dd-mon-yyyy)" },
	{ value: "%m/%d/%Y", label: "12/31/2026 (mm/dd/yyyy)" },
];
const AMOUNT_MODES: { value: AmountMode; label: string }[] = [
	{ value: "debit_credit", label: "Two columns (debit + credit)" },
	{ value: "signed", label: "One signed column (+/−)" },
	{ value: "amount_indicator", label: "Amount + Dr/Cr column" },
];
const ANCHORS: { value: StatementAnchor; label: string }[] = [
	{ value: "balance", label: "Running balance" },
	{ value: "ref", label: "Reference / cheque no." },
];

/** A mapping under construction — every column is a header name or "" (unset). */
interface Draft {
	dateCol: string;
	dateFmt: string;
	amountMode: AmountMode;
	amountCol: string;
	signConvention: "" | "credit_positive" | "debit_positive";
	debitCol: string;
	creditCol: string;
	indicatorCol: string;
	creditToken: string;
	narrationCol: string;
	refCol: string;
	balanceCol: string;
	valueDateCol: string;
	anchor: StatementAnchor;
}

/** Guess a starting mapping from the header names — the user corrects anything wrong. */
function guessDraft(headers: string[]): Draft {
	const find = (re: RegExp) => headers.find((h) => re.test(h)) ?? "";
	const debit = find(/debit|withdraw/i);
	const credit = find(/credit|deposit/i);
	const balance = find(/balance/i);
	return {
		dateCol: find(/date/i) || (headers[0] ?? ""),
		dateFmt: "%d/%m/%Y",
		amountMode: debit && credit ? "debit_credit" : "signed",
		amountCol: find(/amount/i),
		signConvention: "credit_positive",
		debitCol: debit,
		creditCol: credit,
		indicatorCol: find(/dr\/cr|type|indicator/i),
		creditToken: "CR",
		narrationCol: find(/narration|details|description|particular|remark/i),
		refCol: find(/ref|cheque|utr/i),
		balanceCol: balance,
		valueDateCol: "",
		anchor: balance ? "balance" : "ref",
	};
}

const opt = (s: string) => (s.trim() ? s : undefined);

/** Convert the draft into the API mapping payload. */
function toMapping(d: Draft): StatementMapping {
	return {
		dateCol: d.dateCol,
		dateFmt: d.dateFmt,
		amountMode: d.amountMode,
		amountCol: opt(d.amountCol),
		signConvention: d.signConvention || undefined,
		debitCol: opt(d.debitCol),
		creditCol: opt(d.creditCol),
		indicatorCol: opt(d.indicatorCol),
		creditToken: opt(d.creditToken),
		narrationCol: d.narrationCol,
		refCol: opt(d.refCol),
		balanceCol: opt(d.balanceCol),
		valueDateCol: opt(d.valueDateCol),
		anchor: d.anchor,
		quirks: [],
	};
}

function useDebounced<T>(value: T, ms: number): T {
	const [v, setV] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setV(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return v;
}

function ImportPage() {
	const qc = useQueryClient();
	const [csv, setCsv] = useState("");
	const [fileName, setFileName] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const debouncedCsv = useDebounced(csv, 400);
	const hasCsv = debouncedCsv.trim().length > 0;

	const headers = useMemo(
		() => splitCsvHeader(csv.split(/\r?\n/, 1)[0] ?? ""),
		[csv],
	);

	// Auto-detect a saved format by header signature.
	const detectQ = useQuery({
		...orpc.import.detect.queryOptions({ input: { csv: debouncedCsv } }),
		enabled: hasCsv,
	});
	const matched = detectQ.data?.matched ?? null;

	// Wizard mapping state, (re)seeded only when the columns actually change and no saved format matched.
	const [draft, setDraft] = useState<Draft | null>(null);
	const headerKey = headers.join("");
	const seededRef = useRef<string | null>(null);
	useEffect(() => {
		if (!hasCsv || matched) {
			setDraft(null);
			seededRef.current = null;
			return;
		}
		if (seededRef.current !== headerKey) {
			setDraft(guessDraft(headers));
			seededRef.current = headerKey;
		}
	}, [headerKey, hasCsv, matched, headers]);

	const [accountSel, setAccountSel] = useState(NEW_ACCOUNT);
	const [newAccountName, setNewAccountName] = useState("");
	const [formatName, setFormatName] = useState("");

	const accountsQ = useQuery(orpc.accounts.list.queryOptions());
	const accounts = accountsQ.data ?? [];

	const commit = useMutation(orpc.import.commit.mutationOptions());
	const rawQ = useQuery(orpc.import.listRaw.queryOptions());

	const loadFile = async (file: File | undefined | null) => {
		if (!file) return;
		if (
			!/\.csv$/i.test(file.name) &&
			file.type &&
			!/csv|text/.test(file.type)
		) {
			toast.error("Please choose a .csv file.");
			return;
		}
		const text = await file.text();
		setCsv(text);
		setFileName(file.name);
		commit.reset();
		toast.success(`Loaded ${file.name}`);
	};

	// The mapping to preview + commit: the matched format's, or the wizard draft's.
	const wizardMapping = draft ? toMapping(draft) : null;
	const wizardInvalid = wizardMapping
		? validateStatementMapping(wizardMapping)
		: "Loading…";
	const previewMapping =
		matched?.mapping ?? (wizardInvalid ? null : wizardMapping);
	const previewAccountId = matched
		? matched.accountId
		: accountSel === NEW_ACCOUNT
			? undefined
			: Number(accountSel);

	const debouncedMapping = useDebounced(
		previewMapping ? JSON.stringify(previewMapping) : "",
		350,
	);
	const previewQ = useQuery({
		...orpc.import.previewMapping.queryOptions({
			input: {
				csv: debouncedCsv,
				mapping: previewMapping as StatementMapping,
				accountId: previewAccountId,
			},
		}),
		enabled: hasCsv && !!previewMapping && debouncedMapping.length > 0,
	});
	const preview = previewQ.data;

	const doImport = () => {
		if (matched) {
			commit.mutate(
				{ mode: "existing", csv: debouncedCsv, formatId: matched.id },
				commitHandlers(),
			);
			return;
		}
		if (!draft || !wizardMapping || wizardInvalid) return;
		if (!formatName.trim()) {
			toast.error("Name this format so it's remembered next time.");
			return;
		}
		if (accountSel === NEW_ACCOUNT && !newAccountName.trim()) {
			toast.error("Name the account this statement belongs to.");
			return;
		}
		commit.mutate(
			{
				mode: "new",
				csv: debouncedCsv,
				name: formatName.trim(),
				mapping: wizardMapping,
				account:
					accountSel === NEW_ACCOUNT
						? { mode: "new", name: newAccountName.trim() }
						: { mode: "existing", accountId: Number(accountSel) },
			},
			commitHandlers(),
		);
	};

	const commitHandlers = () => ({
		onSuccess: (r: { alreadyPresent: boolean; transactions: number }) => {
			toast.success(
				r.alreadyPresent
					? "Already imported — rebuilt anyway."
					: "Imported and rebuilt.",
			);
			setCsv("");
			setFileName(null);
			setDraft(null);
			setFormatName("");
			setNewAccountName("");
			qc.invalidateQueries();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const dataRows = Math.max(
		0,
		csv.split(/\r?\n/).filter((l) => l.trim().length > 0).length - 1,
	);
	const canImport =
		hasCsv &&
		!commit.isPending &&
		(matched ? true : !!wizardMapping && !wizardInvalid);

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-1">
					<h1 className="font-display font-medium text-3xl tracking-tight">
						Import
					</h1>
					<p className="text-muted-foreground">
						Upload or paste a bank statement CSV. Known formats import in one
						click; a new bank walks through a quick column mapping that's
						remembered for next time.
					</p>
				</header>

				<section className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 font-medium text-sm transition-colors hover:bg-secondary">
							<Upload className="size-4" />
							Upload CSV
							<input
								ref={fileRef}
								type="file"
								accept=".csv,text/csv,text/plain"
								className="hidden"
								onChange={(e) => {
									void loadFile(e.target.files?.[0]);
									e.target.value = "";
								}}
							/>
						</label>
						{fileName ? (
							<span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
								<FileText className="size-3.5" />
								<span className="text-foreground/80">{fileName}</span>
							</span>
						) : (
							<span className="text-muted-foreground text-xs">
								or paste / drop a file below
							</span>
						)}
					</div>

					{/* biome-ignore lint/a11y/noStaticElementInteractions: drop-zone wraps the paste box; the input above is the keyboard path */}
					<div
						onDragOver={(e) => {
							e.preventDefault();
							setDragging(true);
						}}
						onDragLeave={() => setDragging(false)}
						onDrop={(e) => {
							e.preventDefault();
							setDragging(false);
							void loadFile(e.dataTransfer.files?.[0]);
						}}
						className={`rounded-md transition-colors ${dragging ? "ring-2 ring-[var(--covered)] ring-offset-2 ring-offset-background" : ""}`}
					>
						<Textarea
							value={csv}
							onChange={(e) => {
								setCsv(e.target.value);
								setFileName(null);
							}}
							spellCheck={false}
							placeholder={
								"Paste a statement CSV (header row + rows)…\n\n…or drop a .csv file here"
							}
							className="min-h-[12rem] rounded-md font-mono text-xs leading-relaxed"
						/>
					</div>

					{hasCsv && (
						<p className="text-muted-foreground text-xs">
							<span className="tnum text-foreground">{dataRows}</span> data row
							{dataRows === 1 ? "" : "s"} ·{" "}
							<span className="text-foreground/70">
								{headers.slice(0, 8).join(", ")}
								{headers.length > 8 ? "…" : ""}
							</span>
						</p>
					)}

					{hasCsv && detectQ.isLoading && (
						<p className="text-muted-foreground text-sm">Detecting format…</p>
					)}

					{matched && (
						<RecognizedStrip
							name={matched.name}
							accountName={matched.accountName}
						/>
					)}

					{hasCsv && !matched && !detectQ.isLoading && draft && (
						<MappingWizard
							headers={headers}
							draft={draft}
							setDraft={setDraft}
							accounts={accounts}
							accountSel={accountSel}
							setAccountSel={setAccountSel}
							newAccountName={newAccountName}
							setNewAccountName={setNewAccountName}
							formatName={formatName}
							setFormatName={setFormatName}
							invalid={wizardInvalid || null}
						/>
					)}

					{preview && (
						<PreviewPanel preview={preview} loading={previewQ.isFetching} />
					)}

					{hasCsv && (
						<div className="flex flex-wrap items-center gap-2">
							<Button onClick={doImport} disabled={!canImport}>
								<Upload className="size-4" />
								{commit.isPending ? "Importing…" : "Import & rebuild"}
							</Button>
							{!matched && (
								<span className="text-muted-foreground text-xs">
									Saves this mapping as a reusable format.
								</span>
							)}
						</div>
					)}
				</section>

				<RawFiles
					files={rawQ.data ?? []}
					loading={rawQ.isLoading}
					onRemoved={() => qc.invalidateQueries()}
				/>
			</div>
		</main>
	);
}

function RecognizedStrip({
	name,
	accountName,
}: {
	name: string;
	accountName: string | null;
}) {
	return (
		<div
			className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
			style={{ borderColor: tint(IN, 40), background: tint(IN, 8) }}
		>
			<CheckCircle2 className="size-4 shrink-0" style={{ color: IN }} />
			<span>
				Recognised as <span className="font-medium">{name}</span>
				{accountName ? (
					<>
						{" → "}
						<span className="text-muted-foreground">{accountName}</span>
					</>
				) : null}
			</span>
		</div>
	);
}

type AccountRow = { id: number; name: string; kind: string; active: boolean };

function MappingWizard({
	headers,
	draft,
	setDraft,
	accounts,
	accountSel,
	setAccountSel,
	newAccountName,
	setNewAccountName,
	formatName,
	setFormatName,
	invalid,
}: {
	headers: string[];
	draft: Draft;
	setDraft: (d: Draft) => void;
	accounts: AccountRow[];
	accountSel: string;
	setAccountSel: (s: string) => void;
	newAccountName: string;
	setNewAccountName: (s: string) => void;
	formatName: string;
	setFormatName: (s: string) => void;
	invalid: string | null;
}) {
	const cols = headers.map((h) => ({ value: h, label: h }));
	const colsOptional = [{ value: "", label: "— none —" }, ...cols];
	const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

	const accountOptions = [
		...accounts.map((a) => ({ value: String(a.id), label: a.name })),
		{ value: NEW_ACCOUNT, label: "＋ New account" },
	];

	return (
		<div className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 px-4 py-4">
			<div className="flex items-center gap-2">
				<h3 className="font-medium text-sm">New format — map the columns</h3>
				<span className="text-muted-foreground text-xs">
					remembered for next time
				</span>
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Field label="Date column">
					<Select
						aria-label="Date column"
						value={draft.dateCol}
						onValueChange={(v) => set({ dateCol: v })}
						options={cols}
					/>
				</Field>
				<Field label="Date format">
					<Select
						aria-label="Date format"
						value={draft.dateFmt}
						onValueChange={(v) => set({ dateFmt: v })}
						options={DATE_FORMATS}
					/>
				</Field>

				<Field label="Amount style">
					<Select
						aria-label="Amount style"
						value={draft.amountMode}
						onValueChange={(v) => set({ amountMode: v as AmountMode })}
						options={AMOUNT_MODES}
					/>
				</Field>
				<div className="hidden sm:block" />

				{draft.amountMode === "debit_credit" && (
					<>
						<Field label="Debit column">
							<Select
								aria-label="Debit column"
								value={draft.debitCol}
								onValueChange={(v) => set({ debitCol: v })}
								options={cols}
							/>
						</Field>
						<Field label="Credit column">
							<Select
								aria-label="Credit column"
								value={draft.creditCol}
								onValueChange={(v) => set({ creditCol: v })}
								options={cols}
							/>
						</Field>
					</>
				)}
				{draft.amountMode === "signed" && (
					<>
						<Field label="Amount column">
							<Select
								aria-label="Amount column"
								value={draft.amountCol}
								onValueChange={(v) => set({ amountCol: v })}
								options={cols}
							/>
						</Field>
						<Field label="Sign convention">
							<Select
								aria-label="Sign convention"
								value={draft.signConvention || "credit_positive"}
								onValueChange={(v) =>
									set({ signConvention: v as Draft["signConvention"] })
								}
								options={[
									{ value: "credit_positive", label: "Positive = money in" },
									{ value: "debit_positive", label: "Positive = money out" },
								]}
							/>
						</Field>
					</>
				)}
				{draft.amountMode === "amount_indicator" && (
					<>
						<Field label="Amount column">
							<Select
								aria-label="Amount column"
								value={draft.amountCol}
								onValueChange={(v) => set({ amountCol: v })}
								options={cols}
							/>
						</Field>
						<Field label="Dr/Cr column">
							<Select
								aria-label="Indicator column"
								value={draft.indicatorCol}
								onValueChange={(v) => set({ indicatorCol: v })}
								options={cols}
							/>
						</Field>
						<Field label="Credit token">
							<Input
								value={draft.creditToken}
								onChange={(e) => set({ creditToken: e.target.value })}
								placeholder="CR"
							/>
						</Field>
						<div className="hidden sm:block" />
					</>
				)}

				<Field label="Narration column">
					<Select
						aria-label="Narration column"
						value={draft.narrationCol}
						onValueChange={(v) => set({ narrationCol: v })}
						options={cols}
					/>
				</Field>
				<Field label="Value date (optional)">
					<Select
						aria-label="Value date column"
						value={draft.valueDateCol}
						onValueChange={(v) => set({ valueDateCol: v })}
						options={colsOptional}
					/>
				</Field>

				<Field label="Identity anchor">
					<Select
						aria-label="Identity anchor"
						value={draft.anchor}
						onValueChange={(v) => set({ anchor: v as StatementAnchor })}
						options={ANCHORS}
					/>
				</Field>
				{draft.anchor === "balance" ? (
					<Field label="Balance column">
						<Select
							aria-label="Balance column"
							value={draft.balanceCol}
							onValueChange={(v) => set({ balanceCol: v })}
							options={cols}
						/>
					</Field>
				) : (
					<Field label="Reference column">
						<Select
							aria-label="Reference column"
							value={draft.refCol}
							onValueChange={(v) => set({ refCol: v })}
							options={cols}
						/>
					</Field>
				)}
			</div>

			<p className="text-muted-foreground text-xs">
				The <span className="text-foreground/70">identity anchor</span> is how
				re-imports are de-duplicated — a running balance or a reference number
				makes each row uniquely identifiable.
			</p>

			<div className="grid grid-cols-1 gap-3 border-border border-t pt-3 sm:grid-cols-2">
				<Field label="Account">
					<Select
						aria-label="Account"
						value={accountSel}
						onValueChange={setAccountSel}
						options={accountOptions}
					/>
				</Field>
				{accountSel === NEW_ACCOUNT ? (
					<Field label="New account name">
						<Input
							value={newAccountName}
							onChange={(e) => setNewAccountName(e.target.value)}
							placeholder="e.g. HDFC Savings"
						/>
					</Field>
				) : (
					<div className="hidden sm:block" />
				)}
				<Field label="Format name">
					<Input
						value={formatName}
						onChange={(e) => setFormatName(e.target.value)}
						placeholder="e.g. HDFC Savings CSV"
					/>
				</Field>
			</div>

			{invalid && (
				<p
					className="flex items-center gap-1.5 text-xs"
					style={{ color: WARN }}
				>
					<TriangleAlert className="size-3.5" />
					{invalid}
				</p>
			)}
		</div>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1 text-xs">
			<span className="text-muted-foreground">{label}</span>
			{children}
		</div>
	);
}

type Preview =
	| {
			ok: true;
			total: number;
			newRows: number;
			duplicate: number;
			rows: Record<string, unknown>[];
	  }
	| { ok: false; error: string };

function PreviewPanel({
	preview,
	loading,
}: {
	preview: Preview;
	loading: boolean;
}) {
	if (!preview.ok) {
		return (
			<div
				className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
				style={{ borderColor: tint(WARN, 40), background: tint(WARN, 8) }}
			>
				<TriangleAlert
					className="mt-0.5 size-3.5 shrink-0"
					style={{ color: WARN }}
				/>
				<div>
					<p className="font-medium">Couldn't parse with this mapping</p>
					<p className="mt-0.5 break-words text-muted-foreground">
						{preview.error}
					</p>
				</div>
			</div>
		);
	}
	const cols: { key: string; label: string }[] = [
		{ key: "txn_date", label: "Date" },
		{ key: "narration", label: "Narration" },
		{ key: "amount", label: "Amount" },
		{ key: "balance", label: "Balance" },
		{ key: "ref_no", label: "Ref" },
	];
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 px-4 py-3">
			<div className="flex flex-wrap items-center gap-4 text-sm">
				<Stat label="Rows" value={preview.total} />
				<Stat label="New" value={preview.newRows} color={IN} />
				<Stat label="Already imported" value={preview.duplicate} />
				<span className="ml-auto self-center text-muted-foreground text-xs">
					{loading ? "Updating…" : "Preview — nothing written yet."}
				</span>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[32rem] border-collapse text-xs">
					<thead>
						<tr className="text-left text-muted-foreground">
							{cols.map((c) => (
								<th
									key={c.key}
									className="border-border border-b py-1 pr-3 font-medium"
								>
									{c.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="tnum">
						{preview.rows.map((r, i) => (
							<tr
								key={String(r.txn_id ?? i)}
								className="border-border/60 border-b"
							>
								{cols.map((c) => (
									<td key={c.key} className="py-1 pr-3 align-top">
										{cell(r[c.key])}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function cell(v: unknown): string {
	if (v === null || v === undefined) return "—";
	if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v))
		return v.slice(0, 10);
	return String(v);
}

function Stat({
	label,
	value,
	color,
}: {
	label: string;
	value: number;
	color?: string;
}) {
	return (
		<div className="flex flex-col">
			<span className="tnum font-medium text-lg" style={{ color }}>
				{value}
			</span>
			<span className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">
				{label}
			</span>
		</div>
	);
}

interface RawFile {
	name: string;
	bytes: number;
	modified: string;
	formatName: string | null;
	accountName: string | null;
}

function RawFiles({
	files,
	loading,
	onRemoved,
}: {
	files: RawFile[];
	loading: boolean;
	onRemoved: () => void;
}) {
	const remove = useMutation(orpc.import.remove.mutationOptions());
	const [confirming, setConfirming] = useState<string | null>(null);

	const doRemove = (name: string) =>
		remove.mutate(
			{ name },
			{
				onSuccess: () => {
					toast.success(`Removed ${name} and rebuilt.`);
					setConfirming(null);
					onRemoved();
				},
				onError: (e) => toast.error(e.message),
			},
		);

	return (
		<section className="flex flex-col gap-2">
			<div className="border-border border-b-2 pb-2">
				<h2 className="font-display font-medium text-lg">
					Imported statements
				</h2>
			</div>
			{loading && (
				<p className="py-3 text-muted-foreground text-sm">Loading…</p>
			)}
			{!loading && files.length === 0 && (
				<p className="py-3 text-muted-foreground text-sm">
					No raw statement files yet.
				</p>
			)}
			<ul className="flex flex-col">
				{files.map((f) => (
					<li
						key={f.name}
						className="flex items-center gap-3 border-border border-b py-3"
					>
						<FileText className="size-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm">{f.name}</p>
							<p className="tnum text-muted-foreground text-xs">
								{(f.bytes / 1024).toFixed(0)} KB · {formatDay(f.modified)}
								{f.formatName ? ` · ${f.formatName}` : " · unbound"}
								{f.accountName ? ` → ${f.accountName}` : ""}
							</p>
						</div>
						{confirming === f.name ? (
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground text-xs">
									Remove & rebuild?
								</span>
								<Button
									size="sm"
									variant="destructive"
									onClick={() => doRemove(f.name)}
									disabled={remove.isPending}
								>
									{remove.isPending ? "…" : "Yes"}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setConfirming(null)}
									disabled={remove.isPending}
								>
									No
								</Button>
							</div>
						) : (
							<button
								type="button"
								title="Remove this import and rebuild"
								onClick={() => setConfirming(f.name)}
								className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
							>
								<Trash2 className="size-3.5" />
							</button>
						)}
					</li>
				))}
			</ul>
			<p className="text-muted-foreground text-xs">
				Raw files are the source of truth — every rebuild re-reads them.
				Removing one rebuilds without it.
			</p>
		</section>
	);
}
