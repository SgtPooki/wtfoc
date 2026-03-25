export interface StatusResponse {
	collection: string;
	totalChunks: number;
	segments: number;
	embeddingModel: string;
	updatedAt: string;
	sourceTypes: string[];
}

export interface HopConnection {
	method: "edge" | "semantic";
	edgeType?: string;
	confidence: number;
	evidence?: string;
}

export interface TraceHop {
	sourceType: string;
	source: string;
	sourceUrl: string;
	content: string;
	storageId: string;
	connection: HopConnection;
}

export interface TraceStats {
	totalHops: number;
	edgeHops: number;
	semanticHops: number;
	sourceTypes: string[];
}

export interface TraceResponse {
	query: string;
	stats: TraceStats;
	groups: Record<string, TraceHop[]>;
}

export interface QueryResult {
	content: string;
	sourceType: string;
	source: string;
	sourceUrl?: string;
	storageId: string;
	score: number;
	signalScores?: Record<string, number>;
}

export interface QueryResponse {
	query: string;
	results: QueryResult[];
}

export interface EdgesResponse {
	totalEdges: number;
	resolvedEdges: number;
	bareRefs: number;
	unresolvedEdges: number;
	resolution: number;
	topUnresolved: Record<string, number>;
}

export interface SourceInfo {
	sources: string[];
	count: number;
}

export type SourcesResponse = Record<string, SourceInfo>;

export interface CollectionSummary {
	name: string;
	chunks: number;
	segments: number;
	model: string;
	updated: string;
}
