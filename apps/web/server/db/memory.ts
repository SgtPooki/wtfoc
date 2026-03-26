import { randomUUID } from "node:crypto";
import type {
	AuditLogEntry,
	AuditOperation,
	Collection,
	CollectionStatus,
	CreateCollectionInput,
	Repository,
	Source,
	SourceStatus,
	WalletSession,
} from "./repository.js";

export class InMemoryRepository implements Repository {
	readonly sessions = new Map<string, WalletSession>();
	readonly collections = new Map<string, Collection>();
	readonly sources = new Map<string, Source>();
	readonly auditLog: AuditLogEntry[] = [];

	private sessionByToken = new Map<string, string>();
	private sessionByWallet = new Map<string, string>();
	private sourcesByCollection = new Map<string, Set<string>>();

	async createSession(walletAddress: string, cookieToken: string, chainId: number): Promise<WalletSession> {
		// Revoke any existing active session for this wallet
		const existing = this.sessionByWallet.get(walletAddress);
		if (existing) {
			const old = this.sessions.get(existing);
			if (old && !old.revokedAt) {
				old.revokedAt = new Date();
				if (old.cookieToken) this.sessionByToken.delete(old.cookieToken);
			}
		}

		const session: WalletSession = {
			id: randomUUID(),
			walletAddress,
			cookieToken,
			sessionKeyEncrypted: null,
			sessionKeyWalletAddress: null,
			sessionKeyExpiresAt: null,
			chainId,
			createdAt: new Date(),
			lastUsedAt: new Date(),
			revokedAt: null,
		};
		this.sessions.set(session.id, session);
		this.sessionByToken.set(cookieToken, session.id);
		this.sessionByWallet.set(walletAddress, session.id);
		return session;
	}

	async getSessionByToken(cookieToken: string): Promise<WalletSession | null> {
		const id = this.sessionByToken.get(cookieToken);
		if (!id) return null;
		const session = this.sessions.get(id);
		if (!session || session.revokedAt) return null;
		return session;
	}

	async getActiveSessionByWallet(walletAddress: string): Promise<WalletSession | null> {
		const id = this.sessionByWallet.get(walletAddress);
		if (!id) return null;
		const session = this.sessions.get(id);
		if (!session || session.revokedAt) return null;
		return session;
	}

	async updateSessionKey(
		sessionId: string,
		encrypted: Uint8Array,
		walletAddress: string,
		expiresAt: Date,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Session ${sessionId} not found`);
		session.sessionKeyEncrypted = encrypted;
		session.sessionKeyWalletAddress = walletAddress;
		session.sessionKeyExpiresAt = expiresAt;
	}

	async revokeSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.revokedAt = new Date();
		this.sessionByToken.delete(session.cookieToken);
	}

	async deleteSessionKey(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.sessionKeyEncrypted = null;
		session.sessionKeyWalletAddress = null;
		session.sessionKeyExpiresAt = null;
	}

	async touchSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session) session.lastUsedAt = new Date();
	}

	async createCollection(input: CreateCollectionInput): Promise<Collection & { sources: Source[] }> {
		// Check uniqueness
		for (const c of this.collections.values()) {
			if (c.walletAddress === input.walletAddress && c.name === input.name) {
				throw new Error(`Collection "${input.name}" already exists for wallet ${input.walletAddress}`);
			}
		}

		const collection: Collection = {
			id: randomUUID(),
			name: input.name,
			walletAddress: input.walletAddress,
			status: "creating",
			manifestCid: null,
			pieceCid: null,
			carRootCid: null,
			promoteCheckpoint: null,
			sourceCount: input.sources.length,
			segmentCount: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		this.collections.set(collection.id, collection);

		const sources: Source[] = [];
		const sourceIds = new Set<string>();
		for (const s of input.sources) {
			const source: Source = {
				id: randomUUID(),
				collectionId: collection.id,
				sourceType: s.sourceType,
				identifier: s.identifier,
				status: "pending",
				errorMessage: null,
				chunkCount: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			this.sources.set(source.id, source);
			sourceIds.add(source.id);
			sources.push(source);
		}
		this.sourcesByCollection.set(collection.id, sourceIds);

		return { ...collection, sources };
	}

	async getCollection(id: string): Promise<(Collection & { sources: Source[] }) | null> {
		const collection = this.collections.get(id);
		if (!collection) return null;
		const sourceIds = this.sourcesByCollection.get(id) ?? new Set();
		const sources = [...sourceIds].map((sid) => this.sources.get(sid)).filter(Boolean) as Source[];
		return { ...collection, sources };
	}

	async listCollectionsByWallet(walletAddress: string): Promise<Collection[]> {
		return [...this.collections.values()].filter((c) => c.walletAddress === walletAddress);
	}

	async updateCollectionStatus(id: string, status: CollectionStatus): Promise<void> {
		const collection = this.collections.get(id);
		if (!collection) throw new Error(`Collection ${id} not found`);
		collection.status = status;
		collection.updatedAt = new Date();
	}

	async updateCollectionPromotion(
		id: string,
		update: Partial<
			Pick<Collection, "status" | "manifestCid" | "pieceCid" | "carRootCid" | "promoteCheckpoint" | "segmentCount">
		>,
	): Promise<void> {
		const collection = this.collections.get(id);
		if (!collection) throw new Error(`Collection ${id} not found`);
		Object.assign(collection, update);
		collection.updatedAt = new Date();
	}

	async updateSourceStatus(
		id: string,
		status: SourceStatus,
		extra?: { errorMessage?: string; chunkCount?: number },
	): Promise<void> {
		const source = this.sources.get(id);
		if (!source) throw new Error(`Source ${id} not found`);
		source.status = status;
		if (extra?.errorMessage !== undefined) source.errorMessage = extra.errorMessage;
		if (extra?.chunkCount !== undefined) source.chunkCount = extra.chunkCount;
		source.updatedAt = new Date();
	}

	async logAudit(
		walletAddress: string,
		operation: AuditOperation,
		collectionId?: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		this.auditLog.push({
			id: randomUUID(),
			walletAddress,
			operation,
			collectionId: collectionId ?? null,
			metadata: metadata ?? null,
			createdAt: new Date(),
		});
	}

	async close(): Promise<void> {
		// No-op for in-memory
	}
}
