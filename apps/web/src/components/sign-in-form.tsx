import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { Label } from "@money/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { enterToNextField } from "@/lib/enter-next";

import Loader from "./loader";
import { Logo } from "./logo";

export default function SignInForm({
	onSwitchToSignUp,
}: {
	onSwitchToSignUp?: () => void;
}) {
	const navigate = useNavigate({
		from: "/",
	});
	const { isPending } = authClient.useSession();

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
		},
		onSubmit: async ({ value }) => {
			await authClient.signIn.email(
				{
					email: value.email,
					password: value.password,
				},
				{
					onSuccess: () => {
						navigate({
							to: "/",
						});
						toast.success("Sign in successful");
					},
					onError: (error) => {
						toast.error(error.error.message || error.error.statusText);
					},
				},
			);
		},
		validators: {
			onSubmit: z.object({
				email: z.email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
			}),
		},
	});

	if (isPending) {
		return <Loader />;
	}

	return (
		<div className="mx-auto mt-10 w-full max-w-md p-6 max-md:mt-0 max-md:flex max-md:min-h-svh max-md:flex-col max-md:justify-center max-md:px-5 max-md:pt-[max(1.5rem,env(safe-area-inset-top))] max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<div className="mb-6 flex flex-col items-center gap-3">
				<Logo className="size-12" />
				<h1 className="text-center font-display font-semibold text-3xl tracking-tight">
					Welcome back
				</h1>
			</div>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="space-y-4"
			>
				<div>
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
				</div>

				<div>
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
									autoComplete="current-password"
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
				</div>

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
							{isSubmitting ? "Submitting..." : "Sign In"}
						</Button>
					)}
				</form.Subscribe>
			</form>

			{onSwitchToSignUp && (
				<div className="mt-4 text-center">
					<Button
						variant="link"
						onClick={onSwitchToSignUp}
						className="text-indigo-600 hover:text-indigo-800"
					>
						Need an account? Sign Up
					</Button>
				</div>
			)}
		</div>
	);
}
