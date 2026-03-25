import {
	type ScoredEntry,
	type SerializableVectorIndex,
	VectorDimensionMismatchError,
	type VectorEntry,
} from "@wtfoc/common";

interface SerializedVectorEntry {
	id: string;
	vector: number[];
	storageId: string;
	metadata: Record<string, string>;
}

interface SerializedVectorIndex {
	entries: SerializedVectorEntry[];
}

const DEFAULT_SIZE_WARNING_THRESHOLD = 50_000;

export class InMemoryVectorIndex implements SerializableVectorIndex {
	readonly #entries = new Map<string, VectorEntry>();
	#dimensions: number | null = null;
	readonly #sizeWarningThreshold: number;
	#sizeWarningEmitted = false;

	constructor(options?: { sizeWarningThreshold?: number }) {
		this.#sizeWarningThreshold = options?.sizeWarningThreshold ?? DEFAULT_SIZE_WARNING_THRESHOLD;
	}

	get size(): number {
		return this.#entries.size;
	}

	async add(entries: VectorEntry[]): Promise<void> {
		if (entries.length === 0) {
			return;
		}

		for (const entry of entries) {
			this.#assertDimensions(entry.vector);
			this.#entries.set(entry.id, {
				...entry,
				vector: new Float32Array(entry.vector),
				metadata: { ...entry.metadata },
			});
		}

		this.#checkSizeWarning();
	}

	async delete(ids: string[]): Promise<void> {
		for (const id of ids) {
			this.#entries.delete(id);
		}
	}

	async search(query: Float32Array, topK: number): Promise<ScoredEntry[]> {
		if (topK <= 0 || this.#entries.size === 0) {
			return [];
		}

		this.#assertQueryDimensions(query);

		return [...this.#entries.values()]
			.map((entry) => ({
				entry: {
					...entry,
					vector: new Float32Array(entry.vector),
					metadata: { ...entry.metadata },
				},
				score: cosineSimilarity(query, entry.vector),
			}))
			.sort((left, right) => right.score - left.score)
			.slice(0, topK);
	}

	async serialize(): Promise<Uint8Array> {
		const payload: SerializedVectorIndex = {
			entries: [...this.#entries.values()].map((entry) => ({
				id: entry.id,
				vector: Array.from(entry.vector),
				storageId: entry.storageId,
				metadata: { ...entry.metadata },
			})),
		};

		return new TextEncoder().encode(JSON.stringify(payload));
	}

	async deserialize(data: Uint8Array): Promise<void> {
		const decoded = new TextDecoder().decode(data);
		const parsed = JSON.parse(decoded) as SerializedVectorIndex;

		this.#entries.clear();
		this.#dimensions = null;

		for (const entry of parsed.entries) {
			const vector = new Float32Array(entry.vector);
			this.#assertDimensions(vector);
			this.#entries.set(entry.id, {
				id: entry.id,
				vector,
				storageId: entry.storageId,
				metadata: { ...entry.metadata },
			});
		}

		this.#checkSizeWarning();
	}

	#assertDimensions(vector: Float32Array): void {
		if (this.#dimensions === null) {
			this.#dimensions = vector.length;
			return;
		}

		if (vector.length !== this.#dimensions) {
			throw new VectorDimensionMismatchError(this.#dimensions, vector.length, "entry");
		}
	}

	#assertQueryDimensions(vector: Float32Array): void {
		if (this.#dimensions !== null && vector.length !== this.#dimensions) {
			throw new VectorDimensionMismatchError(this.#dimensions, vector.length, "query");
		}
	}

	#checkSizeWarning(): void {
		if (!this.#sizeWarningEmitted && this.#entries.size >= this.#sizeWarningThreshold) {
			this.#sizeWarningEmitted = true;
			console.warn(
				`⚠️  InMemoryVectorIndex has ${this.#entries.size} entries (threshold: ${this.#sizeWarningThreshold}). ` +
					`Consider using a persistent vector backend (e.g., WTFOC_VECTOR_BACKEND=qdrant) for large collections.`,
			);
		}
	}
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
	let dotProduct = 0;
	let leftMagnitude = 0;
	let rightMagnitude = 0;

	for (let index = 0; index < left.length; index += 1) {
		const leftValue = left[index] ?? 0;
		const rightValue = right[index] ?? 0;

		dotProduct += leftValue * rightValue;
		leftMagnitude += leftValue * leftValue;
		rightMagnitude += rightValue * rightValue;
	}

	if (leftMagnitude === 0 || rightMagnitude === 0) {
		return 0;
	}

	return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
