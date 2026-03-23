import {
	type ScoredEntry,
	VectorDimensionMismatchError,
	type VectorEntry,
	type VectorIndex,
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

export class InMemoryVectorIndex implements VectorIndex {
	readonly #entries: VectorEntry[] = [];
	#dimensions: number | null = null;

	get size(): number {
		return this.#entries.length;
	}

	async add(entries: VectorEntry[]): Promise<void> {
		if (entries.length === 0) {
			return;
		}

		for (const entry of entries) {
			this.#assertDimensions(entry.vector);
			this.#entries.push({
				...entry,
				vector: new Float32Array(entry.vector),
				metadata: { ...entry.metadata },
			});
		}
	}

	async search(query: Float32Array, topK: number): Promise<ScoredEntry[]> {
		if (topK <= 0 || this.#entries.length === 0) {
			return [];
		}

		this.#assertQueryDimensions(query);

		return this.#entries
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
			entries: this.#entries.map((entry) => ({
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

		this.#entries.length = 0;
		this.#dimensions = null;

		for (const entry of parsed.entries) {
			const vector = new Float32Array(entry.vector);
			this.#assertDimensions(vector);
			this.#entries.push({
				id: entry.id,
				vector,
				storageId: entry.storageId,
				metadata: { ...entry.metadata },
			});
		}
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
