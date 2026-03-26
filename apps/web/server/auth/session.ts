import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";

const COOKIE_NAME = "wtfoc_session";
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function generateCookieToken(): string {
	return randomBytes(32).toString("hex");
}

export function setSessionCookie(c: Context, token: string): void {
	setCookie(c, COOKIE_NAME, token, {
		httpOnly: true,
		secure: true,
		sameSite: "Strict",
		path: "/api",
		maxAge: COOKIE_MAX_AGE_SECONDS,
	});
}

export function getSessionCookie(c: Context): string | undefined {
	return getCookie(c, COOKIE_NAME);
}

export function clearSessionCookie(c: Context): void {
	deleteCookie(c, COOKIE_NAME, { path: "/api" });
}
