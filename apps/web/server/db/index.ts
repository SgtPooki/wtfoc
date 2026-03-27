import type { Repository } from "./repository.js";

export type { Repository } from "./repository.js";
export type {
	AuditLogEntry,
	AuditOperation,
	Collection,
	CollectionStatus,
	CreateCollectionInput,
	Source,
	SourceStatus,
	SourceType,
	WalletSession,
} from "./repository.js";

export async function createRepository(): Promise<Repository> {
	const databaseUrl = process.env.DATABASE_URL;
	if (databaseUrl) {
		const { PostgresRepository } = await import("./postgres.js");
		const repo = new PostgresRepository(databaseUrl);
		await repo.migrate();
		console.error("[db] Connected to PostgreSQL");
		return repo;
	}

	const { InMemoryRepository } = await import("./memory.js");
	console.error("[db] Using in-memory storage (data will not survive restarts)");
	return new InMemoryRepository();
}
