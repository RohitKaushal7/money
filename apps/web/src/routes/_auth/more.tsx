import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Eye, Lock, LogOut, Moon } from "lucide-react";
import { IconTile, ListGroup, Switch } from "@/components/list-group";
import { useTheme } from "@/components/theme-provider";
import { useIsAdmin } from "@/lib/admin";
import { authClient } from "@/lib/auth-client";
import { closeLock } from "@/lib/lock";
import { DESTINATIONS, type Destination } from "@/lib/nav";
import { usePreference } from "@/lib/preferences";
import { signOutAndClear } from "@/lib/session";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/more")({
	component: MorePage,
});

/**
 * Everything that isn't one of the four tabs, as a grouped list in the shape of a phone's own Settings:
 * inset rounded groups, 56px rows, an icon tile, a chevron where a row goes somewhere and a control where it
 * changes something in place. The things you reach for in public (hide amounts, lock) are here as well as in
 * their usual places, so no one has to remember a keyboard shortcut on a phone.
 */
function MorePage() {
	const isAdmin = useIsAdmin() === true;
	const pages = (group: Destination["moreGroup"]) =>
		DESTINATIONS.filter(
			(d) => d.moreGroup === group && (!d.adminOnly || isAdmin),
		);

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-xl flex-col gap-7 px-4 pt-6 pb-10 sm:px-8 sm:py-14">
				<h1 className="px-1 font-display font-medium text-3xl tracking-tight">
					More
				</h1>

				<ListGroup label="Your money">
					{pages("money").map((d) => (
						<NavRow key={d.to} dest={d} />
					))}
				</ListGroup>

				<ListGroup label="Preferences">
					<PrivacyRow />
					<ThemeRow />
					<LockRow />
				</ListGroup>

				<ListGroup label="App">
					{pages("app").map((d) => (
						<NavRow key={d.to} dest={d} />
					))}
				</ListGroup>

				<AccountGroup />
			</div>
		</main>
	);
}

function NavRow({ dest }: { dest: Destination }) {
	return (
		<Link
			to={dest.to}
			className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors active:bg-secondary/70"
		>
			<IconTile>
				<dest.icon className="size-[1.125rem]" />
			</IconTile>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="text-base">{dest.label}</span>
				{dest.hint && (
					<span className="truncate text-muted-foreground text-sm">
						{dest.hint}
					</span>
				)}
			</span>
			<ChevronRight className="size-5 shrink-0 text-muted-foreground/70" />
		</Link>
	);
}

function PrivacyRow() {
	const [hidden, setHidden] = usePreference("privacy.hidden");
	return (
		<button
			type="button"
			role="switch"
			aria-checked={hidden}
			onClick={() => setHidden(!hidden)}
			className="flex min-h-14 items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-secondary/70"
		>
			<IconTile>
				<Eye className="size-[1.125rem]" />
			</IconTile>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="text-base">Hide amounts</span>
				<span className="text-muted-foreground text-sm">
					For when someone's looking over your shoulder
				</span>
			</span>
			<Switch on={hidden} />
		</button>
	);
}

const THEMES = [
	{ key: "light", label: "Light" },
	{ key: "dark", label: "Dark" },
	{ key: "system", label: "Auto" },
] as const;

function ThemeRow() {
	const { theme, setTheme } = useTheme();
	return (
		<div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
			<IconTile>
				<Moon className="size-[1.125rem]" />
			</IconTile>
			<span className="flex-1 text-base">Theme</span>
			<fieldset
				aria-label="Theme"
				className="m-0 flex rounded-full border-0 bg-secondary p-0.5"
			>
				{THEMES.map((t) => (
					<button
						key={t.key}
						type="button"
						aria-pressed={theme === t.key}
						onClick={() => setTheme(t.key)}
						className={`h-9 rounded-full px-3 text-sm transition-colors ${
							theme === t.key
								? "bg-card font-medium text-foreground shadow-sm"
								: "text-muted-foreground"
						}`}
					>
						{t.label}
					</button>
				))}
			</fieldset>
		</div>
	);
}

/** Only when a PIN exists: locking without one would leave a PIN screen with no PIN to type. */
function LockRow() {
	const qc = useQueryClient();
	const status = useQuery(orpc.lock.status.queryOptions());
	if (!status.data?.configured) return null;
	return (
		<button
			type="button"
			onClick={() => {
				void client.lock.lock().catch(() => {
					// Best effort: dropping the local pass is what locks this tab.
				});
				closeLock();
				qc.clear();
			}}
			className="flex min-h-14 items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-secondary/70"
		>
			<IconTile>
				<Lock className="size-[1.125rem]" />
			</IconTile>
			<span className="flex-1 text-base">Lock now</span>
		</button>
	);
}

function AccountGroup() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const { data: session } = authClient.useSession();
	return (
		<section className="flex flex-col gap-2">
			<h2 className="px-4 font-medium text-muted-foreground text-sm">
				Account
			</h2>
			<div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
				{session && (
					<div className="flex min-h-14 flex-col justify-center px-4 py-2.5">
						<span className="text-base">{session.user.name}</span>
						<span className="truncate text-muted-foreground text-sm">
							{session.user.email}
						</span>
					</div>
				)}
				<button
					type="button"
					onClick={async () => {
						await signOutAndClear(qc);
						navigate({ to: "/login" });
					}}
					className="flex min-h-14 items-center gap-3 px-4 py-2.5 text-left text-destructive transition-colors active:bg-secondary/70"
				>
					<LogOut className="size-5" />
					<span className="text-base">Sign out</span>
				</button>
			</div>
			{/* The release this page is running: after a deploy, a stale PWA cache shows the old number. */}
			<p className="tnum px-4 pt-1 text-muted-foreground text-xs">
				money v{__APP_VERSION__}
			</p>
		</section>
	);
}
