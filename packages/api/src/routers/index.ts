import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { adminRouter } from "./admin";
import { analyticsRouter } from "./analytics";
import { cardsRouter } from "./cards";
import { currencyRouter } from "./currency";
import { importRouter } from "./import";
import { ingestRouter } from "./ingest";
import { networthRouter } from "./networth";
import { overridesRouter } from "./overrides";
import { planRouter } from "./plan";
import { reconcileRouter } from "./reconcile";
import { spendingRouter } from "./spending";
import { splitsRouter } from "./splits";
import { taxRouter } from "./tax";

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
	admin: adminRouter,
	analytics: analyticsRouter,
	cards: cardsRouter,
	plan: planRouter,
	networth: networthRouter,
	currency: currencyRouter,
	reconcile: reconcileRouter,
	overrides: overridesRouter,
	spending: spendingRouter,
	splits: splitsRouter,
	tax: taxRouter,
	import: importRouter,
	ingest: ingestRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
