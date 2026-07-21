import { Button } from "@money/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Field, Section, TextInput } from "@/components/settings/section";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

/** Better-Auth's own floor. Nothing gained by inventing a stricter rule the sign-up form doesn't apply. */
const MIN_PASSWORD = 8;

export function SecurityTab() {
	return (
		<>
			<ChangePassword />
			<ScreenLock />
		</>
	);
}

/**
 * The 4-digit screen lock: off unless you turn it on, and asked for on every fresh load once you have.
 *
 * Setting or clearing it takes your account *password*, not the current PIN. That's what makes forgetting
 * the PIN survivable — sign out, sign in, clear it here — and it stops anyone who finds the app already
 * unlocked from quietly changing the PIN and locking you out of your own machine.
 */
function ScreenLock() {
	const qc = useQueryClient();
	const status = useQuery(orpc.lock.status.queryOptions());
	const configured = status.data?.configured ?? false;

	const [password, setPassword] = useState("");
	const [pin, setPin] = useState("");
	const [confirm, setConfirm] = useState("");

	const reset = () => {
		setPassword("");
		setPin("");
		setConfirm("");
		qc.invalidateQueries({ queryKey: orpc.lock.status.key() });
	};

	const save = useMutation({
		...orpc.lock.setPin.mutationOptions(),
		onSuccess: () => {
			reset();
			toast.success("Screen lock on. ⇧L locks it now.");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const clear = useMutation({
		...orpc.lock.clearPin.mutationOptions(),
		onSuccess: () => {
			reset();
			toast.success("Screen lock off.");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);
	const mismatch = confirm.length === 4 && confirm !== pin;
	const canSave = password.length > 0 && pin.length === 4 && confirm === pin;
	const busy = save.isPending || clear.isPending;

	return (
		<Section
			title="Screen lock"
			action={
				<span
					className={`rounded-full px-3 py-1 font-medium text-xs ${
						configured
							? "bg-[var(--covered)]/15 text-[var(--covered)]"
							: "bg-muted text-muted-foreground"
					}`}
				>
					{configured ? "On" : "Off"}
				</span>
			}
		>
			<p className="max-w-lg text-muted-foreground text-sm">
				A 4-digit PIN, asked for every time the app loads fresh — so someone
				opening it on your unlocked laptop sees nothing. Press{" "}
				<kbd className="rounded border border-border px-1 py-0.5 text-[0.7rem]">
					⇧L
				</kbd>{" "}
				to lock right now. It's a second layer, not a replacement for your
				password.
			</p>

			<form
				className="flex flex-col gap-3"
				onSubmit={(e) => {
					e.preventDefault();
					if (canSave && !busy) save.mutate({ password, pin });
				}}
			>
				<div className="flex flex-wrap items-end gap-3">
					<Field label="Your password">
						<TextInput
							type="password"
							autoComplete="current-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="w-48"
						/>
					</Field>
					<Field label={configured ? "New PIN" : "PIN"}>
						<TextInput
							type="password"
							inputMode="numeric"
							autoComplete="off"
							value={pin}
							onChange={(e) => setPin(digits(e.target.value))}
							className="tnum w-24 tracking-[0.3em]"
						/>
					</Field>
					<Field label="Confirm">
						<TextInput
							type="password"
							inputMode="numeric"
							autoComplete="off"
							value={confirm}
							onChange={(e) => setConfirm(digits(e.target.value))}
							className="tnum w-24 tracking-[0.3em]"
							aria-invalid={mismatch || undefined}
						/>
					</Field>
					<Button type="submit" size="sm" disabled={!canSave || busy}>
						{configured ? "Change PIN" : "Turn on"}
					</Button>
					{configured && (
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={password.length === 0 || busy}
							title="Requires your password"
							onClick={() => clear.mutate({ password })}
						>
							Turn off
						</Button>
					)}
				</div>
				{mismatch && (
					<p className="text-[var(--uncovered)] text-xs">
						The two PINs don't match.
					</p>
				)}
			</form>
		</Section>
	);
}

/**
 * Change your own password. Better-Auth verifies the current one server-side, so a wrong entry fails there
 * rather than being checked here — the form never needs to know what the password is.
 *
 * `revokeOtherSessions` is always on: the reason to change a password is usually that someone else might
 * have it, and leaving their session alive would defeat the point.
 */
function ChangePassword() {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");

	const change = useMutation({
		mutationFn: async () => {
			const res = await authClient.changePassword({
				currentPassword: current,
				newPassword: next,
				revokeOtherSessions: true,
			});
			if (res.error) throw new Error(res.error.message ?? "Couldn't change it");
			return res.data;
		},
		onSuccess: () => {
			setCurrent("");
			setNext("");
			setConfirm("");
			toast.success("Password changed. Other devices were signed out.");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
	const mismatch = confirm.length > 0 && confirm !== next;
	const ready =
		current.length > 0 &&
		next.length >= MIN_PASSWORD &&
		confirm === next &&
		!change.isPending;

	return (
		<Section title="Password">
			<p className="max-w-md text-muted-foreground text-sm">
				Changing it signs you out everywhere else. Forgotten it entirely? Ask an
				admin to set a new one — there's no reset email.
			</p>
			<form
				className="flex flex-col gap-3"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready) change.mutate();
				}}
			>
				{/* A username field even though it's hidden: without it password managers offer to save the
				    new password against no account, and some refuse to autofill the current one at all. */}
				<input
					type="text"
					autoComplete="username"
					className="hidden"
					tabIndex={-1}
					aria-hidden="true"
					readOnly
					value=""
				/>
				<div className="flex flex-wrap items-end gap-3">
					<Field label="Current">
						<TextInput
							type="password"
							autoComplete="current-password"
							value={current}
							onChange={(e) => setCurrent(e.target.value)}
							className="w-48"
						/>
					</Field>
					<Field label="New">
						<TextInput
							type="password"
							autoComplete="new-password"
							value={next}
							onChange={(e) => setNext(e.target.value)}
							className="w-48"
							aria-invalid={tooShort || undefined}
						/>
					</Field>
					<Field label="Confirm">
						<TextInput
							type="password"
							autoComplete="new-password"
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
							className="w-48"
							aria-invalid={mismatch || undefined}
						/>
					</Field>
					<Button type="submit" size="sm" disabled={!ready}>
						{change.isPending ? "Changing…" : "Change password"}
					</Button>
				</div>
				{(tooShort || mismatch) && (
					<p className="text-[var(--uncovered)] text-xs">
						{tooShort
							? `At least ${MIN_PASSWORD} characters.`
							: "The two new passwords don't match."}
					</p>
				)}
			</form>
		</Section>
	);
}
