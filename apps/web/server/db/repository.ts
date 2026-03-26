/** Repository interface for wallet collection flow persistence. */

export interface WalletSession {
	id: string;
	walletAddress: string;
	cookieToken: string;
	sessionKeyEncrypted: Uint8Array | null;
	sessionKeyWalletAddress: string | null;
	sessionKeyExpiresAt: Date | null;
	chainId: number;
	createdAt: Date;
	lastUsedAt: Date;
	revokedAt: Date | null;
}

export type CollectionStatus =
	| "creating"
	| "ingesting"
	| "ready"
	| "ingestion_failed"
	| "promoting"
	| "promoted"
	| "promotion_failed";

export interface Collection {
	id: string;
	name: string;
	walletAddress: string;
	status: CollectionStatus;
	manifestCid: string | null;
	pieceCid: string | null;
	carRootCid: string | null;
	promoteCheckpoint: "car_built" | "uploaded" | "on_chain_written" | null;
	sourceCount: number;
	segmentCount: number | null;
	createdAt: Date;
	updatedAt: Date;
}

export type SourceType = "github" | "website" | "hackernews";
export type SourceStatus = "pending" | "ingesting" | "complete" | "failed";

export interface Source {
	id: string;
	collectionId: string;
	sourceType: SourceType;
	identifier: string;
	status: SourceStatus;
	errorMessage: string | null;
	chunkCount: number | null;
	createdAt: Date;
	updatedAt: Date;
}

export type AuditOperation =
	| "delegated"
	| "used_upload"
	| "used_on_chain"
	| "revoked"
	| "expired"
	| "rotated";

export interface AuditLogEntry {
	id: string;
	walletAddress: string;
	operation: AuditOperation;
	collectionId: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
}

export interface CreateCollectionInput {
	name: string;
	walletAddress: string;
	sources: Array<{ sourceType: SourceType; identifier: string }>;
}

export interface Repository {
	// Wallet sessions
	createSession(walletAddress: string, cookieToken: string, chainId: number): Promise<WalletSession>;
	getSessionByToken(cookieToken: string): Promise<WalletSession | null>;
	getActiveSessionByWallet(walletAddress: string): Promise<WalletSession | null>;
	updateSessionKey(
		sessionId: string,
		encrypted: Uint8Array,
		walletAddress: string,
		expiresAt: Date,
	): Promise<void>;
	revokeSession(sessionId: string): Promise<void>;
	deleteSessionKey(sessionId: string): Promise<void>;
	touchSession(sessionId: string): Promise<void>;

	// Collections
	createCollection(input: CreateCollectionInput): Promise<Collection & { sources: Source[] }>;
	getCollection(id: string): Promise<(Collection & { sources: Source[] }) | null>;
	listCollectionsByWallet(walletAddress: string): Promise<Collection[]>;
	updateCollectionStatus(id: string, status: CollectionStatus): Promise<void>;
	updateCollectionPromotion(
		id: string,
		update: Partial<
			Pick<Collection, "status" | "manifestCid" | "pieceCid" | "carRootCid" | "promoteCheckpoint" | "segmentCount">
		>,
	): Promise<void>;

	// Sources
	updateSourceStatus(
		id: string,
		status: SourceStatus,
		extra?: { errorMessage?: string; chunkCount?: number },
	): Promise<void>;

	// Audit log
	logAudit(
		walletAddress: string,
		operation: AuditOperation,
		collectionId?: string,
		metadata?: Record<string, unknown>,
	): Promise<void>;

	// Lifecycle
	close(): Promise<void>;
}
