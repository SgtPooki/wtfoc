/**
 * Simple counting semaphore for concurrency limiting.
 * Proper wait-queue — no busy-wait polling.
 */
export class Semaphore {
	#count: number;
	readonly #waiters: Array<() => void> = [];

	constructor(count: number) {
		this.#count = count;
	}

	async acquire(): Promise<() => void> {
		if (this.#count > 0) {
			this.#count--;
			return this.#makeRelease();
		}

		return new Promise<() => void>((resolve) => {
			this.#waiters.push(() => {
				this.#count--;
				resolve(this.#makeRelease());
			});
		});
	}

	#makeRelease(): () => void {
		let released = false;
		return () => {
			if (!released) {
				released = true;
				this.#release();
			}
		};
	}

	#release(): void {
		this.#count++;
		const next = this.#waiters.shift();
		if (next) next();
	}
}
