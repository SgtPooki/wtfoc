import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import type {
	AuditOperation,
	Collection,
	CollectionStatus,
	CreateCollectionInput,
	Repository,
	Source,
	SourceStatus,
	WalletSession,
} from "./repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class PostgresRepository implements Repository {
	readonly #pool: pg.Pool;

	constructor(databaseUrl: string) {
		this.#pool = new pg.Pool({ connectionString: databaseUrl });
	}

	async migrate(): Promise<void> {
		const sql = readFileSync(join(__dirname, "schema.sql"), "utf-8");
		await this.#pool.query(sql);
	}

	// --- Wallet sessions ---

	async createSession(walletAddress: string, cookieToken: string, chainId: number): Promise<WalletSession> {
		const client = await this.#pool.connect();
		try {
			await client.query("BEGIN");
			// Revoke existing active sessions for this wallet
			await client.query(
				`UPDATE wallet_sessions SET revoked_at = now() WHERE wallet_address = $1 AND revoked_at IS NULL`,
				[walletAddress],
			);
			const result = await client.query(
				`INSERT INTO wallet_sessions (wallet_address, cookie_token, chain_id) VALUES ($1, $2, $3) RETURNING *`,
				[walletAddress, cookieToken, chainId],
			);
			await client.query("COMMIT");
			return mapSession(result.rows[0]);
		} catch (err) {
			await client.query("ROLLBACK");
			throw err;
		} finally {
			client.release();
		}
	}

	async getSessionByToken(cookieToken: string): Promise<WalletSession | null> {
		const result = await this.#pool.query(
			`SELECT * FROM wallet_sessions WHERE cookie_token = $1 AND revoked_at IS NULL`,
			[cookieToken],
		);
		return result.rows[0] ? mapSession(result.rows[0]) : null;
	}

	async getActiveSessionByWallet(walletAddress: string): Promise<WalletSession | null> {
		const result = await this.#pool.query(
			`SELECT * FROM wallet_sessions WHERE wallet_address = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
			[walletAddress],
		);
		return result.rows[0] ? mapSession(result.rows[0]) : null;
	}

	async updateSessionKey(
		sessionId: string,
		encrypted: Uint8Array,
		walletAddress: string,
		expiresAt: Date,
	): Promise<void> {
		await this.#pool.query(
			`UPDATE wallet_sessions SET session_key_encrypted = $1, session_key_wallet_address = $2, session_key_expires_at = $3 WHERE id = $4`,
			[Buffer.from(encrypted), walletAddress, expiresAt, sessionId],
		);
	}

	async revokeSession(sessionId: string): Promise<void> {
		await this.#pool.query(`UPDATE wallet_sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
	}

	async deleteSessionKey(sessionId: string): Promise<void> {
		await this.#pool.query(
			`UPDATE wallet_sessions SET session_key_encrypted = NULL, session_key_wallet_address = NULL, session_key_expires_at = NULL WHERE id = $1`,
			[sessionId],
		);
	}

	async touchSession(sessionId: string): Promise<void> {
		await this.#pool.query(`UPDATE wallet_sessions SET last_used_at = now() WHERE id = $1`, [sessionId]);
	}

	// --- Collections ---

	async createCollection(input: CreateCollectionInput): Promise<Collection & { sources: Source[] }> {
		const client = await this.#pool.connect();
		try {
			await client.query("BEGIN");
			const colResult = await client.query(
				`INSERT INTO collections (name, wallet_address, source_count) VALUES ($1, $2, $3) RETURNING *`,
				[input.name, input.walletAddress, input.sources.length],
			);
			const collection = mapCollection(colResult.rows[0]);

			const sources: Source[] = [];
			for (const s of input.sources) {
				const srcResult = await client.query(
					`INSERT INTO sources (collection_id, source_type, identifier) VALUES ($1, $2, $3) RETURNING *`,
					[collection.id, s.sourceType, s.identifier],
				);
				sources.push(mapSource(srcResult.rows[0]));
			}
			await client.query("COMMIT");
			return { ...collection, sources };
		} catch (err) {
			await client.query("ROLLBACK");
			throw err;
		} finally {
			client.release();
		}
	}

	async getCollection(id: string): Promise<(Collection & { sources: Source[] }) | null> {
		const colResult = await this.#pool.query(`SELECT * FROM collections WHERE id = $1`, [id]);
		if (!colResult.rows[0]) return null;
		const collection = mapCollection(colResult.rows[0]);
		const srcResult = await this.#pool.query(
			`SELECT * FROM sources WHERE collection_id = $1 ORDER BY created_at`,
			[id],
		);
		const sources = srcResult.rows.map(mapSource);
		return { ...collection, sources };
	}

	async listCollectionsByWallet(walletAddress: string): Promise<Collection[]> {
		const result = await this.#pool.query(
			`SELECT * FROM collections WHERE wallet_address = $1 ORDER BY created_at DESC`,
			[walletAddress],
		);
		return result.rows.map(mapCollection);
	}

	async updateCollectionStatus(id: string, status: CollectionStatus): Promise<void> {
		await this.#pool.query(`UPDATE collections SET status = $1, updated_at = now() WHERE id = $2`, [status, id]);
	}

	async updateCollectionPromotion(
		id: string,
		update: Partial<
			Pick<Collection, "status" | "manifestCid" | "pieceCid" | "carRootCid" | "promoteCheckpoint" | "segmentCount">
		>,
	): Promise<void> {
		const sets: string[] = ["updated_at = now()"];
		const values: unknown[] = [];
		let i = 1;

		if (update.status !== undefined) { sets.push(`status = $${i++}`); values.push(update.status); }
		if (update.manifestCid !== undefined) { sets.push(`manifest_cid = $${i++}`); values.push(update.manifestCid); }
		if (update.pieceCid !== undefined) { sets.push(`piece_cid = $${i++}`); values.push(update.pieceCid); }
		if (update.carRootCid !== undefined) { sets.push(`car_root_cid = $${i++}`); values.push(update.carRootCid); }
		if (update.promoteCheckpoint !== undefined) { sets.push(`promote_checkpoint = $${i++}`); values.push(update.promoteCheckpoint); }
		if (update.segmentCount !== undefined) { sets.push(`segment_count = $${i++}`); values.push(update.segmentCount); }

		values.push(id);
		await this.#pool.query(`UPDATE collections SET ${sets.join(", ")} WHERE id = $${i}`, values);
	}

	// --- Sources ---

	async addSources(
		collectionId: string,
		sources: Array<{ sourceType: SourceType; identifier: string }>,
	): Promise<Source[]> {
		const results: Source[] = [];
		for (const s of sources) {
			const { rows } = await this.#pool.query<Record<string, unknown>>(
				`INSERT INTO sources (collection_id, source_type, identifier) VALUES ($1, $2, $3) RETURNING *`,
				[collectionId, s.sourceType, s.identifier],
			);
			const row = rows[0];
			if (row) results.push(mapSource(row));
		}
		await this.#pool.query(`UPDATE collections SET updated_at = now() WHERE id = $1`, [collectionId]);
		return results;
	}

	async updateSourceStatus(
		id: string,
		status: SourceStatus,
		extra?: { errorMessage?: string; chunkCount?: number },
	): Promise<void> {
		const sets = ["status = $1", "updated_at = now()"];
		const values: unknown[] = [status];
		let i = 2;
		if (extra?.errorMessage !== undefined) { sets.push(`error_message = $${i++}`); values.push(extra.errorMessage); }
		if (extra?.chunkCount !== undefined) { sets.push(`chunk_count = $${i++}`); values.push(extra.chunkCount); }
		values.push(id);
		await this.#pool.query(`UPDATE sources SET ${sets.join(", ")} WHERE id = $${i}`, values);
	}

	// --- Audit ---

	async logAudit(
		walletAddress: string,
		operation: AuditOperation,
		collectionId?: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		await this.#pool.query(
			`INSERT INTO session_key_audit_log (wallet_address, operation, collection_id, metadata) VALUES ($1, $2, $3, $4)`,
			[walletAddress, operation, collectionId ?? null, metadata ? JSON.stringify(metadata) : null],
		);
	}

	async close(): Promise<void> {
		await this.#pool.end();
	}
}

// --- Row mappers ---

function mapSession(row: Record<string, unknown>): WalletSession {
	return {
		id: row.id as string,
		walletAddress: row.wallet_address as string,
		cookieToken: row.cookie_token as string,
		sessionKeyEncrypted: row.session_key_encrypted ? new Uint8Array(row.session_key_encrypted as Buffer) : null,
		sessionKeyWalletAddress: row.session_key_wallet_address as string | null,
		sessionKeyExpiresAt: row.session_key_expires_at ? new Date(row.session_key_expires_at as string) : null,
		chainId: row.chain_id as number,
		createdAt: new Date(row.created_at as string),
		lastUsedAt: new Date(row.last_used_at as string),
		revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : null,
	};
}

function mapCollection(row: Record<string, unknown>): Collection {
	return {
		id: row.id as string,
		name: row.name as string,
		walletAddress: row.wallet_address as string,
		status: row.status as Collection["status"],
		manifestCid: row.manifest_cid as string | null,
		pieceCid: row.piece_cid as string | null,
		carRootCid: row.car_root_cid as string | null,
		promoteCheckpoint: row.promote_checkpoint as Collection["promoteCheckpoint"],
		sourceCount: row.source_count as number,
		segmentCount: row.segment_count as number | null,
		createdAt: new Date(row.created_at as string),
		updatedAt: new Date(row.updated_at as string),
	};
}

function mapSource(row: Record<string, unknown>): Source {
	return {
		id: row.id as string,
		collectionId: row.collection_id as string,
		sourceType: row.source_type as Source["sourceType"],
		identifier: row.identifier as string,
		status: row.status as Source["status"],
		errorMessage: row.error_message as string | null,
		chunkCount: row.chunk_count as number | null,
		createdAt: new Date(row.created_at as string),
		updatedAt: new Date(row.updated_at as string),
	};
}
