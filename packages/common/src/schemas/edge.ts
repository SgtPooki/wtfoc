/**
 * A typed, evidence-backed connection between artifacts across sources.
 *
 * Built-in types: 'references', 'closes', 'changes'
 * Custom types welcome: 'myapp:depends-on', 'myapp:blocks', etc.
 */
export interface Edge {
	/** Relationship type — string for extensibility, not an enum */
	type: string;
	/** ID of the source artifact */
	sourceId: string;
	/** Type of the target artifact */
	targetType: string;
	/** Repo-scoped target ID, e.g. "FilOzone/synapse-sdk#142" */
	targetId: string;
	/** Human-readable explanation of why this edge exists */
	evidence: string;
	/** 1.0 for explicit (regex-extracted), <1.0 for semantic */
	confidence: number;
}
