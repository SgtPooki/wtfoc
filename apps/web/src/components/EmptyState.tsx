import { draftQuery, mode, submitQuery } from "../state";

const EXAMPLE_QUERIES = [
	"How does synapse handle deal storage?",
	"What is the curio scheduler doing?",
	"How does filecoin-pin verify CIDs?",
];

export function EmptyState() {
	function handleClick(q: string) {
		draftQuery.value = q;
		mode.value = "trace";
		submitQuery();
	}

	return (
		<div class="empty-state">
			<h2>Trace anything</h2>
			<p class="muted">
				Ask a question to trace evidence across code, issues, PRs, docs, and chat.
			</p>
			<div class="example-queries">
				{EXAMPLE_QUERIES.map((q) => (
					<button key={q} type="button" class="example-chip" onClick={() => handleClick(q)}>
						{q}
					</button>
				))}
			</div>
		</div>
	);
}
