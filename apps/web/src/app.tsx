import { CollectionPicker } from "./components/CollectionPicker";
import { CreateCollection } from "./components/CreateCollection";
import { EdgePanel } from "./components/EdgePanel";
import { Footer } from "./components/Footer";
import { Layout } from "./components/Layout";
import { SearchView } from "./components/SearchView";
import { SourcesPanel } from "./components/SourcesPanel";
import { TraceView } from "./components/TraceView";
import { activeQuery, collection, isConnected, mode, walletView } from "./state";

export function App() {
	const hasCollection = collection.value.length > 0;
	const hasQuery = activeQuery.value.length > 0;
	const connected = isConnected.value;
	const view = walletView.value;

	return (
		<Layout>
			{connected && view === "create" && <CreateCollection />}
			{connected && view !== "create" && (
				<button
					type="button"
					class="create-collection-btn"
					onClick={() => {
						walletView.value = "create";
					}}
				>
					+ Create Collection
				</button>
			)}
			{!hasCollection && <CollectionPicker />}
			{hasCollection && hasQuery && mode.value === "trace" && <TraceView />}
			{hasCollection && hasQuery && mode.value === "search" && <SearchView />}
			{hasCollection && !hasQuery && <CollectionPicker />}
			{hasCollection && <SourcesPanel />}
			{hasCollection && <EdgePanel />}
			<Footer />
		</Layout>
	);
}
