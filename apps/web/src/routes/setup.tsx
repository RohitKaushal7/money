import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { Label } from "@money/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { enterToNextField } from "@/lib/enter-next";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/setup")({
	component: SetupPage,
	// Self-closing: once the owner exists, /setup is a dead end → send them to sign in.
	beforeLoad: async () => {
		const { needsSetup } = await client.setup.status();
		if (!needsSetup) {
			throw redirect({ to: "/login" });
		}
	},
});

function SetupPage() {
	const navigate = useNavigate({ from: "/setup" });

	const form = useForm({
		defaultValues: { name: "", email: "", password: "" },
		validators: {
			onSubmit: z.object({
				name: z.string().min(1, "Your name"),
				email: z.email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
			}),
		},
		onSubmit: async ({ value }) => {
			try {
				await client.setup.createAdmin(value);
			} catch (e) {
				toast.error((e as Error).message);
				return;
			}
			await authClient.signIn.email(
				{ email: value.email, password: value.password },
				{
					onSuccess: () => {
						toast.success("Welcome — your account is ready.");
						navigate({ to: "/" });
					},
					onError: (error) => {
						toast.error(error.error.message || error.error.statusText);
					},
				},
			);
		},
	});

	return (
		<div className="mx-auto mt-10 w-full max-w-md p-6 max-md:mt-0 max-md:flex max-md:min-h-svh max-md:flex-col max-md:justify-center max-md:px-5 max-md:pt-[max(1.5rem,env(safe-area-inset-top))] max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<div className="mb-6 flex flex-col items-center gap-3">
				<Logo className="size-12" />
				<h1 className="text-center font-display font-semibold text-3xl tracking-tight">
					Create your account
				</h1>
				<p className="text-center text-muted-foreground text-sm">
					This is the owner account for this install. There's no one above you.
				</p>
			</div>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="space-y-4"
			>
				<form.Field name="name">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name} className="max-md:text-sm">
								Name
							</Label>
							<Input
								id={field.name}
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
								autoComplete="name"
								autoCapitalize="words"
								enterKeyHint="next"
								onKeyDown={enterToNextField}
								className="max-md:h-12 max-md:rounded-xl max-md:px-4 max-md:text-base"
							/>
							{field.state.meta.errors.map((error) => (
								<p key={error?.message} className="text-red-500">
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Field name="email">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name} className="max-md:text-sm">
								Email
							</Label>
							<Input
								id={field.name}
								name={field.name}
								type="email"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
								autoComplete="email"
								autoCapitalize="none"
								autoCorrect="off"
								spellCheck={false}
								inputMode="email"
								enterKeyHint="next"
								onKeyDown={enterToNextField}
								className="max-md:h-12 max-md:rounded-xl max-md:px-4 max-md:text-base"
							/>
							{field.state.meta.errors.map((error) => (
								<p key={error?.message} className="text-red-500">
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Field name="password">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name} className="max-md:text-sm">
								Password
							</Label>
							<Input
								id={field.name}
								name={field.name}
								type="password"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
								autoComplete="new-password"
								enterKeyHint="go"
								className="max-md:h-12 max-md:rounded-xl max-md:px-4 max-md:text-base"
							/>
							{field.state.meta.errors.map((error) => (
								<p key={error?.message} className="text-red-500">
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						isSubmitting: state.isSubmitting,
					})}
				>
					{({ canSubmit, isSubmitting }) => (
						<Button
							type="submit"
							className="w-full max-md:h-12 max-md:rounded-xl max-md:text-base"
							disabled={!canSubmit || isSubmitting}
						>
							{isSubmitting ? "Creating…" : "Create account"}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}
