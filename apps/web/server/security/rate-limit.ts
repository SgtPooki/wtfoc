import type { Context, Next } from "hono";
import { RateLimitError } from "@wtfoc/common";

interface RateLimitBucket {
	count: number;
	resetAt: number;
}

interface RateLimitConfig {
	/** Maximum requests per window */
	limit: number;
	/** Window size in seconds */
	windowSeconds: number;
	/** Function to extract the rate-limit key from a request */
	keyFn: (c: Context) => string;
}

export class RateLimiter {
	readonly #buckets = new Map<string, RateLimitBucket>();
	readonly #config: RateLimitConfig;

	constructor(config: RateLimitConfig) {
		this.#config = config;
	}

	check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
		const now = Date.now();
		const bucket = this.#buckets.get(key);

		if (!bucket || now >= bucket.resetAt) {
			const resetAt = now + this.#config.windowSeconds * 1000;
			this.#buckets.set(key, { count: 1, resetAt });
			return { allowed: true, remaining: this.#config.limit - 1, resetAt };
		}

		if (bucket.count >= this.#config.limit) {
			return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
		}

		bucket.count++;
		return { allowed: true, remaining: this.#config.limit - bucket.count, resetAt: bucket.resetAt };
	}

	middleware() {
		return async (c: Context, next: Next) => {
			const key = this.#config.keyFn(c);
			const result = this.check(key);

			c.header("X-RateLimit-Limit", String(this.#config.limit));
			c.header("X-RateLimit-Remaining", String(result.remaining));
			c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

			if (!result.allowed) {
				throw new RateLimitError(key, this.#config.limit, this.#config.windowSeconds);
			}

			await next();
		};
	}
}

/**
 * Extract the client IP from proxy headers.
 * Uses only the rightmost (last) entry in x-forwarded-for, which is the one
 * set by the closest trusted proxy rather than the client-supplied value.
 * Falls back to x-real-ip or "unknown" for direct connections.
 */
function extractClientIp(c: Context): string {
	const xff = c.req.header("x-forwarded-for");
	if (xff) {
		const parts = xff.split(",").map((s) => s.trim());
		return parts[parts.length - 1] || "unknown";
	}
	return c.req.header("x-real-ip") ?? "unknown";
}

/** Rate limiter keyed by wallet address (from auth context) */
export function walletRateLimiter(limit: number, windowSeconds: number): RateLimiter {
	return new RateLimiter({
		limit,
		windowSeconds,
		keyFn: (c) => {
			const wallet = c.get("walletAddress") as string | undefined;
			return wallet ?? extractClientIp(c);
		},
	});
}

/** Rate limiter keyed by IP address */
export function ipRateLimiter(limit: number, windowSeconds: number): RateLimiter {
	return new RateLimiter({
		limit,
		windowSeconds,
		keyFn: (c) => extractClientIp(c),
	});
}
