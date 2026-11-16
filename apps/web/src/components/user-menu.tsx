import { Button } from "@money/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@money/ui/components/dropdown-menu";
import { Skeleton } from "@money/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { signOutAndClear } from "@/lib/session";

export default function UserMenu() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return <Skeleton className="h-9 w-24" />;
	}

	if (!session) {
		return (
			<Link to="/login">
				<Button variant="outline">Sign In</Button>
			</Link>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline" />}>
				{session.user.name}
			</DropdownMenuTrigger>
			<DropdownMenuContent className="bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel>My Account</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem>{session.user.email}</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onClick={async () => {
							await signOutAndClear(queryClient);
							navigate({ to: "/login" });
						}}
					>
						Sign Out
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				{/* The release this page is running — after a deploy, a stale PWA cache shows the old number. */}
				<p className="tnum px-2 py-1.5 text-muted-foreground text-xs">
					money v{__APP_VERSION__}
				</p>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
