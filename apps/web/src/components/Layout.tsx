import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fetchStatus } from "../api";
import { collection } from "../state";
import type { StatusResponse } from "../types";
import { SearchBar } from "./SearchBar";
import { WalletConnect } from "./WalletConnect";

interface LayoutProps {
	children: ComponentChildren;
}

export function Layout({ children }: LayoutProps) {
	const [status, setStatus] = useState<StatusResponse | null>(null);
	const col = collection.value;

	useEffect(() => {
		if (!col) {
			setStatus(null);
			return;
		}
		fetchStatus(col)
			.then(setStatus)
			.catch(() => {});
	}, [col]);

	return (
		<div class="app">
			<header>
				<img src="/logo.png" alt="wtFOC" class="header-logo" width="36" height="36" />
				<h1>
					wt<span class="accent">FOC</span>
				</h1>
				<WalletConnect />
				{status && (
					<div class="stats-bar">
						<span>
							<strong>{(status.totalChunks / 1000).toFixed(1)}K</strong> chunks
						</span>
						<span>
							<strong>{status.segments}</strong> segments
						</span>
						<span>
							<strong>{status.sourceTypes.length}</strong> source types
						</span>
					</div>
				)}
			</header>

			<SearchBar />

			<main>{children}</main>
		</div>
	);
}
