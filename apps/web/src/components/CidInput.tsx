import { useState } from "preact/hooks";
import { collection } from "../state";

export function CidInput() {
	const [cid, setCid] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	function handleSubmit(e: Event) {
		e.preventDefault();
		const trimmed = cid.trim();
		if (!trimmed) return;

		setLoading(true);
		setError(null);

		// Set the collection to the CID — the API client routes to /api/collections/cid/:cid/...
		collection.value = `cid:${trimmed}`;
		setLoading(false);
	}

	return (
		<div class="cid-input-section">
			<h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Open by CID</h3>
			<p class="muted" style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}>
				Paste a manifest CID to load a collection from IPFS
			</p>
			<form onSubmit={handleSubmit} class="cid-form">
				<input
					type="text"
					value={cid}
					onInput={(e) => setCid((e.target as HTMLInputElement).value)}
					placeholder="bafy..."
					class="cid-input"
					disabled={loading}
				/>
				<button type="submit" class="cid-submit" disabled={loading || !cid.trim()}>
					{loading ? "Loading..." : "Open"}
				</button>
			</form>
			{error && <p class="cid-error">{error}</p>}
		</div>
	);
}
