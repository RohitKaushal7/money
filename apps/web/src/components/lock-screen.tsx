import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import { Delete, Lock } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { haptics } from "@/lib/haptics";
import { closeLock, openLock, useLockState } from "@/lib/lock";
import { client, queryClient } from "@/utils/orpc";

export const LOCK_HOTKEY = "Shift+L";
const PIN_LENGTH = 4;

/**
 * Stands between the authenticated layout and everything under it.
 *
 * While locked it renders the PIN screen *instead of* the app — not over it. That matters for more than
 * looks: an overlay would leave the pages beneath it mounted, firing queries that the server rejects and
 * filling the screen with errors. Nothing below this point exists until the lock opens.
 */
export function LockGate({ children }: { children: ReactNode }) {
	const state = useLockState();

	// One claim per page load. The server hands back a pass only for a session created moments ago — i.e.
	// one you just made by signing in — so a reload lands here and gets nothing.
	useEffect(() => {
		let cancelled = false;
		client.lock
			.claim()
			.then((r) => {
				if (cancelled) return;
				if (!r.configured || r.token) openLock(r.token);
				else closeLock();
			})
			.catch(() => {
				// Can't reach the server, or the session is gone. Treating that as unlocked is right: the
				// API is the thing that enforces the lock, and it will reject anything that matters.
				if (!cancelled) openLock(null);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (state === "checking") return null;
	if (state === "locked") return <LockScreen />;
	return <>{children}</>;
}

/**
 * ⇧L locks immediately.
 *
 * Registered once by the layout, like ⇧H. Clearing the query cache is not housekeeping — it's the point:
 * cached balances would otherwise still be sitting in memory behind the lock screen, and would paint
 * instantly if anything re-rendered.
 */
export function useLockHotkey() {
	useHotkey(LOCK_HOTKEY, () => {
		void client.lock.lock().catch(() => {
			// Best effort. The local token is dropped either way, which is what actually locks this tab.
		});
		closeLock();
		queryClient.clear();
	});
}

function LockScreen() {
	const [pin, setPin] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [shake, setShake] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();
	const phone = useIsPhone();

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	async function submit(value: string) {
		setBusy(true);
		setError(null);
		try {
			const r = await client.lock.unlock({ pin: value });
			openLock(r.token);
		} catch (e) {
			setError((e as Error).message || "Wrong PIN.");
			setPin("");
			setShake((n) => n + 1);
			haptics.refused();
			inputRef.current?.focus();
		} finally {
			setBusy(false);
		}
	}

	function onChange(raw: string) {
		const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
		setPin(digits);
		setError(null);
		if (digits.length === PIN_LENGTH) void submit(digits);
	}

	if (phone)
		return (
			<PhoneLockScreen
				pin={pin}
				error={error}
				busy={busy}
				shake={shake}
				onChange={onChange}
				onForgot={async () => {
					queryClient.clear();
					await authClient.signOut();
					navigate({ to: "/login" });
				}}
			/>
		);

	return (
		<div className="flex h-svh w-full flex-col items-center justify-center gap-8 bg-background px-6">
			<div className="flex flex-col items-center gap-2">
				<Lock className="size-5 text-muted-foreground" />
				<span className="font-display font-medium text-2xl tracking-tight">
					money
				</span>
				<p className="text-muted-foreground text-sm">Enter your PIN</p>
			</div>

			{/*
			 * One real input behind four drawn boxes. Four separate inputs would mean juggling focus on every
			 * keystroke, paste and backspace — this way the browser handles all of it and the boxes are only
			 * a rendering of how much has been typed.
			 */}
			<button
				type="button"
				aria-label="Enter your PIN"
				onClick={() => inputRef.current?.focus()}
				key={shake}
				className={`relative flex gap-3 ${shake > 0 ? "lock-shake" : ""}`}
			>
				{Array.from({ length: PIN_LENGTH }, (_, i) => (
					<span
						key={`slot-${i}`}
						className={`flex size-12 items-center justify-center rounded-lg border text-2xl transition-colors ${
							error
								? "border-[var(--uncovered)]"
								: i < pin.length
									? "border-foreground/40"
									: "border-border"
						}`}
					>
						{i < pin.length ? "•" : ""}
					</span>
				))}
				<input
					ref={inputRef}
					value={pin}
					onChange={(e) => onChange(e.target.value)}
					disabled={busy}
					type="password"
					inputMode="numeric"
					autoComplete="off"
					// biome-ignore lint/a11y/noAutofocus: it is the only control on the screen
					autoFocus
					className="absolute inset-0 cursor-default opacity-0"
				/>
			</button>

			<p
				className={`min-h-5 text-sm ${error ? "text-[var(--uncovered)]" : "text-muted-foreground"}`}
			>
				{error ?? (busy ? "Checking…" : " ")}
			</p>

			{/*
			 * The way out when you've forgotten the PIN: signing in again lands you unlocked, and you can
			 * clear it in Settings. Safe to offer, because getting back in still needs the password.
			 */}
			<button
				type="button"
				className="text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
				onClick={async () => {
					queryClient.clear();
					await authClient.signOut();
					navigate({ to: "/login" });
				}}
			>
				Forgot your PIN? Sign out and use your password
			</button>
		</div>
	);
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

/**
 * The lock on a phone: four dots and a keypad of its own, like the phone's own lock screen, rather than
 * a hidden field that summons the system keyboard (which covers half the screen and offers letters).
 *
 * Same semantics as the desktop path: the fourth digit submits, a wrong PIN clears, shakes and buzzes. A
 * hardware keyboard still types digits and Backspace, since there is no field to type into.
 */
function PhoneLockScreen({
	pin,
	error,
	busy,
	shake,
	onChange,
	onForgot,
}: {
	pin: string;
	error: string | null;
	busy: boolean;
	shake: number;
	onChange: (next: string) => void;
	onForgot: () => void;
}) {
	// Two taps can land before React re-renders, so each tap builds on the last tap's PIN, not the render's.
	const pinRef = useRef(pin);
	pinRef.current = pin;
	const press = (key: string) => {
		if (busy) return;
		const cur = pinRef.current;
		if (key !== "del" && cur.length >= PIN_LENGTH) return;
		const next = key === "del" ? cur.slice(0, -1) : cur + key;
		pinRef.current = next;
		onChange(next);
	};

	// Read through a ref so the listener stays attached once, yet always sees the latest PIN.
	const pressRef = useRef(press);
	pressRef.current = press;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (/^\d$/.test(e.key)) pressRef.current(e.key);
			else if (e.key === "Backspace") pressRef.current("del");
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div className="flex h-svh w-full flex-col items-center justify-between bg-background px-6 pt-[max(3rem,calc(env(safe-area-inset-top)+2rem))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<div className="flex flex-col items-center gap-2">
				<Lock className="size-5 text-muted-foreground" />
				<span className="font-display font-medium text-2xl tracking-tight">
					money
				</span>
				<p className="text-base text-muted-foreground">Enter your PIN</p>
			</div>

			<div className="flex flex-col items-center gap-4">
				<div
					key={shake}
					role="img"
					aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}
					className={`flex gap-5 ${shake > 0 ? "lock-shake" : ""}`}
				>
					{Array.from({ length: PIN_LENGTH }, (_, i) => (
						<span
							key={`dot-${i}`}
							className={`size-3.5 rounded-full border-2 transition-colors duration-150 ${
								error
									? "border-[var(--uncovered)]"
									: i < pin.length
										? "border-foreground bg-foreground"
										: "border-muted-foreground/50"
							}`}
						/>
					))}
				</div>
				<p
					aria-live="polite"
					className={`min-h-5 text-sm ${error ? "text-[var(--uncovered)]" : "text-muted-foreground"}`}
				>
					{error ?? (busy ? "Checking…" : " ")}
				</p>
			</div>

			<div className="flex flex-col items-center gap-6">
				<div className="grid grid-cols-3 gap-x-7 gap-y-4">
					{KEYS.map((k, i) =>
						k === "" ? (
							<span key={`blank-${i}`} aria-hidden="true" />
						) : k === "del" ? (
							<button
								key={k}
								type="button"
								aria-label="Delete last digit"
								disabled={busy || pin.length === 0}
								onClick={() => press("del")}
								className="pressable flex size-16 items-center justify-center rounded-full text-foreground transition-opacity disabled:opacity-30"
							>
								<Delete className="size-6" />
							</button>
						) : (
							<button
								key={k}
								type="button"
								disabled={busy}
								onClick={() => press(k)}
								className="pressable tnum flex size-16 items-center justify-center rounded-full bg-secondary font-display text-[1.75rem] text-foreground transition-colors active:bg-muted-foreground/25 disabled:opacity-60"
							>
								{k}
							</button>
						),
					)}
				</div>
				<button
					type="button"
					className="min-h-11 px-3 text-muted-foreground text-sm underline underline-offset-4"
					onClick={onForgot}
				>
					Forgot your PIN? Sign out and use your password
				</button>
			</div>
		</div>
	);
}
