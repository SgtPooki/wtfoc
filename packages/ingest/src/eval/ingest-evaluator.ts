import type { CollectionHead, EvalCheck, EvalStageResult, Segment } from "@wtfoc/common";

interface ChunkLike {
	id: string;
	content: string;
	sourceType: string;
	source: string;
	documentId?: string;
	documentVersionId?: string;
	contentFingerprint?: string;
}

function isPopulated(val: unknown): boolean {
	return typeof val === "string" && val.length > 0;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Evaluate ingest quality: chunk well-formedness, metadata completeness,
 * sizing, and per-source-type breakdown.
 */
export async function evaluateIngest(
	segments: Segment[],
	_head: CollectionHead,
): Promise<EvalStageResult> {
	const startedAt = new Date().toISOString();
	const t0 = performance.now();

	const chunks: ChunkLike[] = segments.flatMap((s) => s.chunks);
	const totalChunks = chunks.length;
	const checks: EvalCheck[] = [];

	// Source-type distribution
	const sourceTypeDistribution: Record<string, number> = {};
	for (const c of chunks) {
		const st = c.sourceType || "unknown";
		sourceTypeDistribution[st] = (sourceTypeDistribution[st] || 0) + 1;
	}

	// Chunks-per-segment distribution
	const chunksPerSegment = segments.map((s) => s.chunks.length);

	// Required fields check
	const requiredFields = ["id", "content", "sourceType", "source"] as const;
	for (const field of requiredFields) {
		const violations = chunks.filter((c) => !isPopulated(c[field as keyof ChunkLike])).length;
		checks.push({
			name: `required:${field}`,
			passed: violations === 0,
			actual: violations,
			expected: 0,
			detail: violations > 0 ? `${violations} chunk(s) missing ${field}` : undefined,
		});
	}

	// Metadata completeness (overall)
	const metaFields = ["documentId", "documentVersionId", "contentFingerprint"] as const;
	const metaRates: Record<string, number> = {};
	for (const field of metaFields) {
		const populated = chunks.filter((c) => isPopulated(c[field as keyof ChunkLike])).length;
		metaRates[`${field}Rate`] = totalChunks > 0 ? populated / totalChunks : 0;
	}

	// Per-source-type metadata breakdown
	const perSourceType: Record<string, Record<string, number>> = {};
	for (const [st, _count] of Object.entries(sourceTypeDistribution)) {
		const stChunks = chunks.filter((c) => (c.sourceType || "unknown") === st);
		const stTotal = stChunks.length;
		const rates: Record<string, number> = {};
		for (const field of metaFields) {
			const pop = stChunks.filter((c) => isPopulated(c[field as keyof ChunkLike])).length;
			rates[`${field}Rate`] = stTotal > 0 ? pop / stTotal : 0;
		}
		perSourceType[st] = rates;
	}

	// Chunk sizing
	const lengths = chunks.map((c) => c.content.length);
	const minLength = lengths.length > 0 ? lengths.reduce((a, b) => Math.min(a, b), Infinity) : 0;
	const maxLength = lengths.length > 0 ? lengths.reduce((a, b) => Math.max(a, b), -Infinity) : 0;
	const meanLength = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
	const medianLength = median(lengths);

	const tooShort = chunks.filter((c) => c.content.length < 50).length;
	const tooLong = chunks.filter((c) => c.content.length > 10_000).length;

	if (tooShort > 0) {
		checks.push({
			name: "sizing:too-short",
			passed: false,
			actual: tooShort,
			expected: 0,
			detail: `${tooShort} chunk(s) under 50 characters`,
		});
	}
	if (tooLong > 0) {
		checks.push({
			name: "sizing:too-long",
			passed: false,
			actual: tooLong,
			expected: 0,
			detail: `${tooLong} chunk(s) over 10,000 characters`,
		});
	}

	// Metadata completeness checks — these affect verdict for incremental readiness
	const fingerprintRate = metaRates.contentFingerprintRate ?? 0;
	const docIdRate = metaRates.documentIdRate ?? 0;
	if (fingerprintRate < 0.5) {
		checks.push({
			name: "metadata:low-fingerprint",
			passed: false,
			actual: Math.round(fingerprintRate * 100),
			expected: ">= 50%",
			detail: `Only ${Math.round(fingerprintRate * 100)}% of chunks have contentFingerprint — incremental re-processing won't work`,
		});
	}
	if (docIdRate < 0.5) {
		checks.push({
			name: "metadata:low-documentId",
			passed: false,
			actual: Math.round(docIdRate * 100),
			expected: ">= 50%",
			detail: `Only ${Math.round(docIdRate * 100)}% of chunks have documentId — document catalog tracking won't work`,
		});
	}

	// Verdict
	const hasRequiredViolations = checks.some((c) => c.name.startsWith("required:") && !c.passed);
	const hasSizingWarnings = checks.some((c) => c.name.startsWith("sizing:") && !c.passed);
	const hasMetadataWarnings = checks.some((c) => c.name.startsWith("metadata:") && !c.passed);

	let verdict: "pass" | "warn" | "fail" = "pass";
	if (hasRequiredViolations) verdict = "fail";
	else if (hasSizingWarnings || hasMetadataWarnings) verdict = "warn";

	const durationMs = Math.round(performance.now() - t0);

	return {
		stage: "ingest",
		startedAt,
		durationMs,
		verdict,
		summary: `${totalChunks} chunks across ${segments.length} segments, ${Object.keys(sourceTypeDistribution).length} source types`,
		metrics: {
			totalChunks,
			segmentCount: segments.length,
			sourceTypeDistribution,
			chunksPerSegment: {
				min:
					chunksPerSegment.length > 0
						? chunksPerSegment.reduce((a, b) => Math.min(a, b), Infinity)
						: 0,
				max:
					chunksPerSegment.length > 0
						? chunksPerSegment.reduce((a, b) => Math.max(a, b), -Infinity)
						: 0,
				mean:
					chunksPerSegment.length > 0
						? chunksPerSegment.reduce((a, b) => a + b, 0) / chunksPerSegment.length
						: 0,
			},
			...metaRates,
			sizing: { min: minLength, max: maxLength, mean: meanLength, median: medianLength },
			perSourceType,
		},
		checks,
	};
}
