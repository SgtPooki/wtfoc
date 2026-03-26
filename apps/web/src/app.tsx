import { CollectionDetail } from "./components/CollectionDetail";
import { CollectionPicker } from "./components/CollectionPicker";
import { CreateCollection } from "./components/CreateCollection";
import { EdgePanel } from "./components/EdgePanel";
import { Footer } from "./components/Footer";
import { Layout } from "./components/Layout";
import { SearchView } from "./components/SearchView";
import { SourcesPanel } from "./components/SourcesPanel";
import { TraceView } from "./components/TraceView";
import {
	activeCollectionId,
	activeQuery,
	collection,
	isConnected,
	mode,
	walletView,
} from "./state";

export function App() {
	const hasCollection = collection.value.length > 0;
	const hasQuery = activeQuery.value.length > 0;
	const connected = isConnected.value;
	const view = walletView.value;

	return (
		<Layout>
			{/* Wallet collection flow views */}
			{connected && view === "create" && <CreateCollection />}
			{connected && view === "detail" && activeCollectionId.value && (
				<CollectionDetail collectionId={activeCollectionId.value} />
			)}
			{connected && view !== "create" && view !== "detail" && (
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

			{/* Existing search/trace views */}
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
