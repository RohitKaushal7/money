import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { analyticsRouter } from "./analytics";
import { importRouter } from "./import";
import { ingestRouter } from "./ingest";
import { overridesRouter } from "./overrides";
import { planRouter } from "./plan";
import { reconcileRouter } from "./reconcile";
import { spendingRouter } from "./spending";
import { splitsRouter } from "./splits";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session?.user,
		};
	}),
	analytics: analyticsRouter,
	plan: planRouter,
	reconcile: reconcileRouter,
	overrides: overridesRouter,
	spending: spendingRouter,
	splits: splitsRouter,
	import: importRouter,
	ingest: ingestRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
