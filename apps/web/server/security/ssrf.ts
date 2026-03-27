import { resolve4, resolve6 } from "node:dns/promises";

const BLOCKED_IPV4_RANGES = [
	{ prefix: "10.", desc: "RFC1918" },
	{ prefix: "172.16.", desc: "RFC1918" },
	{ prefix: "172.17.", desc: "RFC1918" },
	{ prefix: "172.18.", desc: "RFC1918" },
	{ prefix: "172.19.", desc: "RFC1918" },
	{ prefix: "172.20.", desc: "RFC1918" },
	{ prefix: "172.21.", desc: "RFC1918" },
	{ prefix: "172.22.", desc: "RFC1918" },
	{ prefix: "172.23.", desc: "RFC1918" },
	{ prefix: "172.24.", desc: "RFC1918" },
	{ prefix: "172.25.", desc: "RFC1918" },
	{ prefix: "172.26.", desc: "RFC1918" },
	{ prefix: "172.27.", desc: "RFC1918" },
	{ prefix: "172.28.", desc: "RFC1918" },
	{ prefix: "172.29.", desc: "RFC1918" },
	{ prefix: "172.30.", desc: "RFC1918" },
	{ prefix: "172.31.", desc: "RFC1918" },
	{ prefix: "192.168.", desc: "RFC1918" },
	{ prefix: "127.", desc: "loopback" },
	{ prefix: "0.", desc: "unspecified" },
	{ prefix: "169.254.", desc: "link-local" },
];

const BLOCKED_METADATA_IPS = new Set(["169.254.169.254", "fd00::1"]);

function isBlockedIp(ip: string): string | null {
	if (BLOCKED_METADATA_IPS.has(ip)) return "cloud metadata endpoint";
	for (const range of BLOCKED_IPV4_RANGES) {
		if (ip.startsWith(range.prefix)) return range.desc;
	}
	if (ip.startsWith("::1") || ip === "::") return "IPv6 loopback/unspecified";
	if (ip.startsWith("fc") || ip.startsWith("fd")) return "IPv6 unique local";
	if (ip.startsWith("fe80")) return "IPv6 link-local";
	return null;
}

async function resolveHostIps(hostname: string): Promise<string[]> {
	const ips: string[] = [];
	try {
		ips.push(...(await resolve4(hostname)));
	} catch {
		// No A records
	}
	try {
		ips.push(...(await resolve6(hostname)));
	} catch {
		// No AAAA records
	}
	return ips;
}

export interface SsrfValidationResult {
	safe: boolean;
	reason?: string;
}

/**
 * Validate a URL for SSRF safety. Checks:
 * 1. HTTPS-only
 * 2. Resolves hostname to IP
 * 3. Blocks private/link-local/metadata IPs
 * 4. Validates content-type (optional, for response checking)
 */
export async function validateUrl(rawUrl: string): Promise<SsrfValidationResult> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { safe: false, reason: "Invalid URL format" };
	}

	if (url.protocol !== "https:") {
		return { safe: false, reason: "Only HTTPS URLs are allowed" };
	}

	if (url.hostname === "localhost" || url.hostname.endsWith(".local")) {
		return { safe: false, reason: "Localhost and .local domains are blocked" };
	}

	const ips = await resolveHostIps(url.hostname);
	if (ips.length === 0) {
		return { safe: false, reason: `Could not resolve hostname: ${url.hostname}` };
	}

	for (const ip of ips) {
		const blocked = isBlockedIp(ip);
		if (blocked) {
			return { safe: false, reason: `IP ${ip} is in a blocked range (${blocked})` };
		}
	}

	return { safe: true };
}

/**
 * Re-validate a URL after redirect (DNS rebinding defense).
 * Call this for each hop in a redirect chain.
 */
export async function validateRedirectTarget(redirectUrl: string): Promise<SsrfValidationResult> {
	return validateUrl(redirectUrl);
}

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain", "application/xhtml+xml"]);

/**
 * Validate the Content-Type of a response.
 */
export function validateContentType(contentType: string | null): SsrfValidationResult {
	if (!contentType) {
		return { safe: false, reason: "Missing Content-Type header" };
	}
	const mimeType = (contentType.split(";")[0] ?? "").trim().toLowerCase();
	if (!ALLOWED_CONTENT_TYPES.has(mimeType)) {
		return { safe: false, reason: `Content-Type "${mimeType}" is not allowed (only HTML/text)` };
	}
	return { safe: true };
}
