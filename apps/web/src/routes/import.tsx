import { Button } from "@money/ui/components/button";
import { Textarea } from "@money/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatDay } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/import")({ component: ImportPage });

const IN = "var(--covered)";
const tint = (c: string, pct: number) =>
	`color-mix(in oklab, ${c} ${pct}%, transparent)`;

function ImportPage() {
	const qc = useQueryClient();
	const [csv, setCsv] = useState("");

	const dryRun = useMutation(orpc.import.dryRun.mutationOptions());
	const commit = useMutation(orpc.import.commit.mutationOptions());
	const rawQ = useQuery(orpc.import.listRaw.queryOptions());

	// instant, client-side shape check before any server round-trip
	const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
	const dataRows = Math.max(0, lines.length - 1);
	const columns =
		lines[0]?.split(",").map((c) => c.trim().replace(/^"|"$/g, "")) ?? [];

	const preview = () => {
		dryRun.reset();
		dryRun.mutate({ csv });
	};
	const doImport = () =>
		commit.mutate(
			{ csv },
			{
				onSuccess: (r) => {
					toast.success(
						r.alreadyPresent
							? "That statement was already imported — rebuilt anyway."
							: `Imported ${r.rowsNew} new row${r.rowsNew === 1 ? "" : "s"}.`,
					);
					setCsv("");
					dryRun.reset();
					qc.invalidateQueries();
				},
				onError: (e) => toast.error(e.message),
			},
		);

	const busy = dryRun.isPending || commit.isPending;

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-1">
					<h1 className="font-display font-medium text-3xl tracking-tight">
						Import
					</h1>
					<p className="text-muted-foreground">
						Paste an SBI statement export (CSV). Preview counts new vs
						already-imported rows; committing saves it as an immutable raw file
						and rebuilds. Re-pasting the same statement is a safe no-op.
					</p>
				</header>

				<section className="flex flex-col gap-3">
					<Textarea
						value={csv}
						onChange={(e) => setCsv(e.target.value)}
						spellCheck={false}
						placeholder={
							"Date,Details,Ref No/Cheque No,Debit,Credit,Balance\n15/07/2026,…"
						}
						className="min-h-[15rem] rounded-md font-mono text-xs leading-relaxed"
					/>

					{csv.trim().length > 0 && (
						<p className="text-muted-foreground text-xs">
							<span className="tnum text-foreground">{dataRows}</span> data row
							{dataRows === 1 ? "" : "s"}
							{columns.length > 0 && (
								<>
									{" · "}
									<span className="text-foreground/70">
										{columns.slice(0, 6).join(", ")}
										{columns.length > 6 ? "…" : ""}
									</span>
								</>
							)}
						</p>
					)}

					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="outline"
							onClick={preview}
							disabled={csv.trim().length === 0 || busy}
						>
							{dryRun.isPending ? "Checking…" : "Preview"}
						</Button>
						<Button
							onClick={doImport}
							disabled={csv.trim().length === 0 || busy}
						>
							<Upload className="size-4" />
							{commit.isPending ? "Importing…" : "Import & rebuild"}
						</Button>
					</div>

					{dryRun.data && (
						<DryRunPanel
							total={dryRun.data.rowsTotal}
							fresh={dryRun.data.rowsNew}
							dup={dryRun.data.rowsDuplicate}
						/>
					)}
					{commit.data && (
						<CommitPanel
							transactions={commit.data.transactions}
							uncategorized={commit.data.uncategorized}
							fresh={commit.data.rowsNew}
						/>
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

function DryRunPanel({
	total,
	fresh,
	dup,
}: {
	total: number;
	fresh: number;
	dup: number;
}) {
	return (
		<div className="flex flex-wrap gap-4 rounded-lg border border-border bg-card/40 px-4 py-3 text-sm">
			<Stat label="Rows" value={total} />
			<Stat label="New" value={fresh} color={IN} />
			<Stat label="Already imported" value={dup} />
			<p className="ml-auto self-center text-muted-foreground text-xs">
				Nothing written yet — this is a preview.
			</p>
		</div>
	);
}

function CommitPanel({
	transactions,
	uncategorized,
	fresh,
}: {
	transactions: number;
	uncategorized: number;
	fresh: number;
}) {
	return (
		<div
			className="flex flex-wrap gap-4 rounded-lg border px-4 py-3 text-sm"
			style={{ borderColor: tint(IN, 40), background: tint(IN, 8) }}
		>
			<Stat label="New rows" value={fresh} color={IN} />
			<Stat label="Total transactions" value={transactions} />
			<Stat label="Still uncategorised" value={uncategorized} />
		</div>
	);
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
