import { useEffect, useState } from "preact/hooks";
import { fetchStatus } from "../api";
import { collection } from "../state";

export function CidInput() {
	const [cid, setCid] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// If the collection is already a CID (e.g., from URL), show it in the input
	useEffect(() => {
		if (collection.value.startsWith("cid:")) {
			setCid(collection.value.slice(4));
		}
	}, []);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		const trimmed = cid.trim();
		if (!trimmed || loading) return;

		setLoading(true);
		setError(null);

		const cidCollection = `cid:${trimmed}`;

		try {
			// Probe the status endpoint to verify the CID resolves before switching
			await fetchStatus(cidCollection);
			collection.value = cidCollection;
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to load collection";
			setError(message);
		} finally {
			setLoading(false);
		}
	}

	return (
		<div style={{ marginTop: "1.5rem" }}>
			<h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Open by CID</h3>
			<p class="muted" style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}>
				Paste a manifest CID to load a collection from Filecoin
			</p>
			<form onSubmit={handleSubmit} class="search-row">
				<input
					type="text"
					value={cid}
					onInput={(e) => {
						setCid((e.target as HTMLInputElement).value);
						setError(null);
					}}
					placeholder="bafy..."
					disabled={loading}
				/>
				<button type="submit" disabled={loading || !cid.trim()}>
					{loading ? "Resolving..." : "Open"}
				</button>
			</form>
			{error && (
				<p style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "0.5rem" }}>{error}</p>
			)}
		</div>
	);
}
