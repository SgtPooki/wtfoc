/**
 * Hono sub-application for wallet collection flow routes.
 * Mounted alongside the existing raw HTTP server at /api/auth/* and /api/wallet-collections/*.
 * The existing server handles /api/collections/:name/*, /mcp, and static files.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import type { Repository } from "./db/index.js";

export type AppEnv = {
	Variables: {
		walletAddress: string;
		sessionId: string;
		repo: Repository;
	};
};

export function createHonoApp(repo: Repository): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	// Middleware: CORS for all routes
	app.use("*", cors());

	// Middleware: CSRF on mutating endpoints
	app.use(
		"*",
		csrf({
			origin: (origin) => {
				// Allow same-origin and localhost in development
				if (!origin) return true;
				try {
					const url = new URL(origin);
					return url.hostname === "localhost" || url.hostname === "wtfoc.xyz" || url.hostname.endsWith(".wtfoc.xyz");
				} catch {
					return false;
				}
			},
		}),
	);

	// Inject repository into context
	app.use("*", async (c, next) => {
		c.set("repo", repo);
		await next();
	});

	// Global error handler
	app.onError((err, c) => {
		const code = "code" in err ? (err as { code: string }).code : "INTERNAL_ERROR";
		const status = getStatusForCode(code);
		console.error(`[hono] ${c.req.method} ${c.req.path} error:`, err.message);
		return c.json({ error: err.message, code }, status as 400);
	});

	return app;
}

function getStatusForCode(code: string): number {
	switch (code) {
		case "SESSION_EXPIRED":
		case "SESSION_KEY_REVOKED":
		case "WALLET_VERIFICATION_FAILED":
			return 401;
		case "RATE_LIMIT_EXCEEDED":
			return 429;
		default:
			return 500;
	}
}
