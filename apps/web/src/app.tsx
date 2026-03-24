import { CollectionPicker } from "./components/CollectionPicker";
import { EdgePanel } from "./components/EdgePanel";
import { Layout } from "./components/Layout";
import { SearchView } from "./components/SearchView";
import { SourcesPanel } from "./components/SourcesPanel";
import { TraceView } from "./components/TraceView";
import { activeQuery, collection, mode } from "./state";

export function App() {
	const hasCollection = collection.value.length > 0;
	const hasQuery = activeQuery.value.length > 0;

	return (
		<Layout>
			{!hasCollection && <CollectionPicker />}
			{hasCollection && hasQuery && mode.value === "trace" && <TraceView />}
			{hasCollection && hasQuery && mode.value === "search" && <SearchView />}
			{hasCollection && !hasQuery && <CollectionPicker />}
			{hasCollection && <SourcesPanel />}
			{hasCollection && <EdgePanel />}
		</Layout>
	);
}
