import { useState } from "preact/hooks";
import { createCollection } from "../api.js";
import { activeCollectionId, walletView } from "../state.js";

interface SourceInput {
	type: string;
	identifier: string;
}

export function CreateCollection() {
	const [name, setName] = useState("");
	const [sources, setSources] = useState<SourceInput[]>([{ type: "github", identifier: "" }]);
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [createdId, setCreatedId] = useState<string | null>(null);

	const addSource = () => {
		setSources([...sources, { type: "github", identifier: "" }]);
	};

	const removeSource = (index: number) => {
		setSources(sources.filter((_, i) => i !== index));
	};

	const updateSource = (index: number, field: keyof SourceInput, value: string) => {
		const updated = [...sources];
		const source = updated[index];
		if (source) {
			source[field] = value;
			setSources(updated);
		}
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setError(null);
		setSubmitting(true);

		try {
			const result = await createCollection(name, sources);
			setCreatedId(result.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	};

	if (createdId) {
		return (
			<div class="create-collection-success">
				<h3>Collection created</h3>
				<p>Ingestion has started in the background.</p>
				<button
					type="button"
					onClick={() => {
						activeCollectionId.value = createdId;
						walletView.value = "detail";
					}}
				>
					View Progress
				</button>
			</div>
		);
	}

	return (
		<form class="create-collection" onSubmit={handleSubmit}>
			<h3>Create Collection</h3>

			<label>
				Name
				<input
					type="text"
					value={name}
					onInput={(e) => setName((e.target as HTMLInputElement).value)}
					placeholder="my-collection"
					required
					pattern="[a-zA-Z0-9_-]+"
				/>
			</label>

			<fieldset>
				<legend>Sources</legend>
				{sources.map((source, i) => (
					<div class="source-row" key={i}>
						<select
							value={source.type}
							onChange={(e) => updateSource(i, "type", (e.target as HTMLSelectElement).value)}
						>
							<option value="github">GitHub (owner/repo)</option>
							<option value="website">Website (HTTPS URL)</option>
							<option value="hackernews">HackerNews (thread ID)</option>
						</select>
						<input
							type="text"
							value={source.identifier}
							onInput={(e) => updateSource(i, "identifier", (e.target as HTMLInputElement).value)}
							placeholder={
								source.type === "github"
									? "owner/repo"
									: source.type === "website"
										? "https://example.com"
										: "12345678"
							}
							required
						/>
						{sources.length > 1 && (
							<button type="button" onClick={() => removeSource(i)} title="Remove source">
								x
							</button>
						)}
					</div>
				))}
				<button type="button" onClick={addSource}>
					+ Add Source
				</button>
			</fieldset>

			{error && <div class="form-error">{error}</div>}

			<button type="submit" disabled={submitting}>
				{submitting ? "Creating..." : "Create Collection"}
			</button>
		</form>
	);
}
