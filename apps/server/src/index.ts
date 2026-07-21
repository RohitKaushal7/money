import { createContext, UNLOCK_HEADER } from "@money/api/context";
import { appRouter } from "@money/api/routers/index";
import { auth } from "@money/auth";
import { env } from "@money/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN ?? env.BETTER_AUTH_URL,
		allowMethods: ["GET", "POST", "OPTIONS"],
		// x-unlock-token carries the screen-lock pass; without it here the browser drops the header in dev,
		// where the SPA (:3001) and the API (:3000) are different origins, and every call reads as locked.
		allowHeaders: ["Content-Type", "Authorization", UNLOCK_HEADER],
		credentials: true,
	}),
);

// Liveness probe for the container healthcheck — cheap, no DB/session, always plain text.
app.get("/healthz", (c) => c.text("OK"));

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

app.use("/*", async (c, next) => {
	const context = await createContext({ context: c });

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context: context,
	});

	if (rpcResult.matched) {
		return rpcResult.response;
	}

	const apiResult = await apiHandler.handle(c.req.raw, {
		prefix: "/api-reference",
		context: context,
	});

	if (apiResult.matched) {
		return apiResult.response;
	}

	await next();
});

// In production this same container serves the built web SPA (single origin — see the deploy setup).
// The API middleware above already returns for /rpc, /api-reference, and /api/auth/*; everything else is
// either a static asset or a client-side route, so any unmatched path falls back to index.html.
if (env.NODE_ENV === "production") {
	app.use("/*", serveStatic({ root: "./apps/web/dist" }));
	app.get("*", serveStatic({ path: "./apps/web/dist/index.html" }));
}

export default app;
