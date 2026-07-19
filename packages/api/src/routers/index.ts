import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { analyticsRouter } from "./analytics";
import { overridesRouter } from "./overrides";
import { planRouter } from "./plan";
import { reconcileRouter } from "./reconcile";

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
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
