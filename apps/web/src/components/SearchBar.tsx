import { clearSearch, draftQuery, loading, mode, submitQuery } from "../state";

export function SearchBar() {
	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			submitQuery();
		}
		if (e.key === "Escape") {
			clearSearch();
		}
	}

	function handleModeChange(m: "trace" | "search") {
		mode.value = m;
	}

	return (
		<div class="search-container">
			<div class="search-row">
				<input
					type="text"
					placeholder="Trace a question across all sources..."
					value={draftQuery.value}
					onInput={(e) => {
						draftQuery.value = (e.target as HTMLInputElement).value;
					}}
					onKeyDown={handleKeyDown}
					autofocus
				/>
				<button type="button" onClick={submitQuery} disabled={loading.value}>
					{loading.value ? "..." : mode.value === "trace" ? "Trace" : "Search"}
				</button>
			</div>
			<div class="mode-toggle">
				<label class={mode.value === "trace" ? "active" : ""}>
					<input
						type="radio"
						name="mode"
						value="trace"
						checked={mode.value === "trace"}
						onChange={() => handleModeChange("trace")}
					/>
					<span>Trace</span>
				</label>
				<label class={mode.value === "search" ? "active" : ""}>
					<input
						type="radio"
						name="mode"
						value="search"
						checked={mode.value === "search"}
						onChange={() => handleModeChange("search")}
					/>
					<span>Search</span>
				</label>
			</div>
		</div>
	);
}
