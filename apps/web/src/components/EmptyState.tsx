import { draftQuery, mode, submitQuery } from "../state";

const EXAMPLE_QUERIES = [
	"Why did checkout latency spike after the release?",
	"Who decided to deprecate this API, and why?",
	"What are customers actually requesting?",
	"How does deal storage flow through the pipeline?",
];

export function EmptyState() {
	function handleClick(q: string) {
		draftQuery.value = q;
		mode.value = "trace";
		submitQuery();
	}

	return (
		<div class="empty-state">
			<h2>What the FOC happened?</h2>
			<p class="subtitle">
				Turn scattered signals into portable, evidence-backed memory — from code to
				customers — stored on Filecoin Onchain Cloud (FOC) or anywhere you run.
			</p>
			<p class="micro-line">
				Not another vague RAG — every answer is tied to real sources you can inspect.
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
