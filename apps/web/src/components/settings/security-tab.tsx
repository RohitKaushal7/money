import { Button } from "@money/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Field, Section, TextInput } from "@/components/settings/section";
import { authClient } from "@/lib/auth-client";

/** Better-Auth's own floor. Nothing gained by inventing a stricter rule the sign-up form doesn't apply. */
const MIN_PASSWORD = 8;

export function SecurityTab() {
	return <ChangePassword />;
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
