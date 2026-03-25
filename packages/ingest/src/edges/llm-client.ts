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
		max_tokens: 2000,
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
		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: controller.signal,
		});

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
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Parse JSON from LLM response content with three-tier fallback:
 * 1. Direct JSON.parse (if response is valid JSON)
 * 2. Extract from fenced code block
 * 3. Extract from first [ ... ] or { ... } in response
 */
export function parseJsonResponse<T>(content: string): T | null {
	// Tier 1: direct parse
	try {
		return JSON.parse(content) as T;
	} catch {
		// continue to fallback
	}

	// Tier 2: fenced block
	const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
	if (fencedMatch?.[1]) {
		try {
			return JSON.parse(fencedMatch[1].trim()) as T;
		} catch {
			// continue
		}
	}

	// Tier 3: first JSON array or object (non-greedy to avoid over-capture)
	const bracketMatch = /(\[[\s\S]*?\]|\{[\s\S]*?\})/.exec(content);
	if (bracketMatch?.[1]) {
		try {
			return JSON.parse(bracketMatch[1]) as T;
		} catch {
			// give up
		}
	}

	return null;
}
