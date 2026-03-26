/**
 * LLM-powered post-processing for theme clusters.
 * Generates human-readable labels for clusters and summarizes noise chunks.
 * Uses the existing chatCompletion() + parseJsonResponse() from @wtfoc/ingest.
 */

import { chatCompletion, parseJsonResponse } from "@wtfoc/ingest";
import type { LlmExtractorEnabled } from "./extractor-config.js";

interface ClusterLabelRequest {
	clusterId: string;
	exemplarContents: string[];
}

interface ClusterLabelResult {
	clusterId: string;
	label: string;
}

/**
 * Generate LLM-powered labels for a batch of clusters.
 * Sends all clusters in a single prompt to minimize LLM calls.
 */
export async function labelClusters(
	clusters: ClusterLabelRequest[],
	config: LlmExtractorEnabled,
): Promise<Map<string, string>> {
	const labels = new Map<string, string>();
	if (clusters.length === 0) return labels;

	// Build a prompt with all clusters' exemplars
	const clusterDescriptions = clusters.map((c) => {
		const snippets = c.exemplarContents
			.map((content, i) => `  Snippet ${i + 1}: ${content.slice(0, 300)}`)
			.join("\n");
		return `Cluster ${c.clusterId}:\n${snippets}`;
	});

	const prompt = `You are analyzing content clusters from a knowledge base. For each cluster below, generate a short, human-readable topic label (3-8 words) that describes what the cluster is about.

${clusterDescriptions.join("\n\n")}

Respond with a JSON array of objects, each with "clusterId" and "label" fields. Example:
[{"clusterId": "cluster-0", "label": "Authentication and session management"}]

Return ONLY the JSON array, no other text.`;

	try {
		const response = await chatCompletion([{ role: "user", content: prompt }], {
			baseUrl: config.baseUrl,
			model: config.model,
			apiKey: config.apiKey,
			timeoutMs: config.timeoutMs,
		});

		const parsed = parseJsonResponse<ClusterLabelResult[]>(response.content);
		if (parsed && Array.isArray(parsed)) {
			for (const item of parsed) {
				if (item.clusterId && item.label) {
					labels.set(item.clusterId, item.label);
				}
			}
		}
	} catch (err) {
		console.error(`Warning: LLM labeling failed, using heuristic labels: ${err}`);
	}

	return labels;
}

interface NoiseSummaryResult {
	categories: Array<{ name: string; count: number; description: string }>;
}

/**
 * Summarize noise chunks into broad topic categories via a single LLM call.
 * Samples up to `sampleSize` noise chunks to keep the prompt manageable.
 */
export async function summarizeNoise(
	noiseContents: string[],
	config: LlmExtractorEnabled,
	sampleSize = 50,
): Promise<Array<{ name: string; count: number; description: string }>> {
	if (noiseContents.length === 0) return [];

	// Sample noise chunks evenly across the set
	const step = Math.max(1, Math.floor(noiseContents.length / sampleSize));
	const sampled: string[] = [];
	for (let i = 0; i < noiseContents.length && sampled.length < sampleSize; i += step) {
		const content = noiseContents[i];
		if (content) sampled.push(content.slice(0, 200));
	}

	const prompt = `You are analyzing ${noiseContents.length} unclustered chunks from a knowledge base. Here is a sample of ${sampled.length} chunks:

${sampled.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Group these into 5-10 broad topic categories. For each category, estimate how many of the total ${noiseContents.length} noise chunks likely belong to it based on the sample distribution.

Respond with a JSON object with a "categories" array. Each entry has "name" (short label), "count" (estimated count out of ${noiseContents.length}), and "description" (one sentence).

Return ONLY the JSON object, no other text.`;

	try {
		const response = await chatCompletion([{ role: "user", content: prompt }], {
			baseUrl: config.baseUrl,
			model: config.model,
			apiKey: config.apiKey,
			timeoutMs: config.timeoutMs,
		});

		const parsed = parseJsonResponse<NoiseSummaryResult>(response.content);
		if (parsed?.categories && Array.isArray(parsed.categories)) {
			return parsed.categories;
		}
	} catch (err) {
		console.error(`Warning: noise summarization failed: ${err}`);
	}

	return [];
}
