/**
 * Thin OpenAI-compatible chat completion client.
 * No SDK dependency — uses raw fetch for portability across
 * vLLM, LM Studio, OpenAI, and any compatible endpoint.
 */

export interface LlmClientOptions {
	baseUrl: string;
	model: string;
	apiKey?: string;
	timeoutMs?: number;
	jsonMode?: "auto" | "on" | "off";
}

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LlmResponse {
	content: string;
	usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Call a chat completion endpoint and return the response content.
 * JSON mode behavior:
 * - "on": sets response_format: { type: "json_object" } (requires server support)
 * - "auto" or "off": relies on prompt to produce JSON (most compatible with local servers)
 * Response parsing uses three-tier fallback: direct JSON → fenced block → bracket extraction
 */
export async function chatCompletion(
	messages: ChatMessage[],
	options: LlmClientOptions,
	signal?: AbortSignal,
): Promise<LlmResponse> {
	const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (options.apiKey) {
		headers.Authorization = `Bearer ${options.apiKey}`;
	}

	const body: Record<string, unknown> = {
		model: options.model,
		messages,
		temperature: 0,
		max_tokens: 4000,
	};

	// JSON mode: "on" forces response_format, "auto" relies on prompt only
	// (many local servers like LM Studio reject response_format)
	if (options.jsonMode === "on") {
		body.response_format = { type: "json_object" };
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);

	// Chain external signal
	if (signal) {
		if (signal.aborted) {
			clearTimeout(timeout);
			throw signal.reason;
		}
		signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
	}

	try {
		const maxRetries = 3;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			// Retry on rate limit with backoff
			if (response.status === 429 && attempt < maxRetries) {
				const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
				const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(10000, 2000 * 2 ** attempt);
				console.error(
					`[wtfoc] Rate limited (429), waiting ${(waitMs / 1000).toFixed(1)}s before retry ${attempt + 1}/${maxRetries}`,
				);
				await new Promise((r) => setTimeout(r, waitMs));
				continue;
			}

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new Error(`LLM request failed: ${response.status} ${response.statusText} ${text}`);
			}

			const data = (await response.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
				usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
			};

			const content = data.choices?.[0]?.message?.content ?? "";

			return { content, usage: data.usage };
		}
		throw new Error("LLM request failed: rate limited after max retries");
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Try to parse and unwrap a JSON value. If it's an object with a single
 * array value (e.g. { "edges": [...] }), return the array.
 */
function tryParseAndUnwrap<T>(text: string): T | null {
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const values = Object.values(parsed);
			if (values.length === 1 && Array.isArray(values[0])) {
				return values[0] as T;
			}
		}
		return parsed as T;
	} catch {
		return null;
	}
}

/**
 * Parse JSON from LLM response content with multi-tier fallback:
 * 1. Direct JSON.parse (unwraps single-key object wrappers)
 * 2. Extract from fenced code block
 * 3. Extract outermost [ ... ] bracket pair
 */
export function parseJsonResponse<T>(content: string): T | null {
	const trimmed = content.trim();

	// Tier 1: direct parse
	const direct = tryParseAndUnwrap<T>(trimmed);
	if (direct !== null) return direct;

	// Tier 2: fenced block
	const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
	if (fencedMatch?.[1]) {
		const fenced = tryParseAndUnwrap<T>(fencedMatch[1].trim());
		if (fenced !== null) return fenced;
	}

	// Tier 3: extract outermost [ ... ] or { ... } bracket pair
	const arrayStart = trimmed.indexOf("[");
	const arrayEnd = trimmed.lastIndexOf("]");
	if (arrayStart >= 0 && arrayEnd > arrayStart) {
		const bracket = tryParseAndUnwrap<T>(trimmed.slice(arrayStart, arrayEnd + 1));
		if (bracket !== null) return bracket;
	}
	const objStart = trimmed.indexOf("{");
	const objEnd = trimmed.lastIndexOf("}");
	if (objStart >= 0 && objEnd > objStart) {
		const bracket = tryParseAndUnwrap<T>(trimmed.slice(objStart, objEnd + 1));
		if (bracket !== null) return bracket;
	}

	return null;
}
