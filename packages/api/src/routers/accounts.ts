import { accounts } from "@money/db";
import { asc } from "drizzle-orm";
import { protectedProcedure } from "../index";

/**
 * Accounts (spec 2026-07-21 generic CSV importer). Read-only for now — accounts are created implicitly by the
 * import wizard (`import.commit` mode `new`); full management (rename/type/archive) is a later feature. The
 * import wizard's account picker reads this list.
 */
export const accountsRouter = {
	/** All accounts (id + name + kind), active first. */
	list: protectedProcedure.handler(async ({ context }) => {
		return context.appDb
			.select({
				id: accounts.id,
				name: accounts.name,
				kind: accounts.kind,
				active: accounts.active,
			})
			.from(accounts)
			.orderBy(asc(accounts.id));
	}),
};
