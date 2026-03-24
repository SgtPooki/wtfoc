import {
	forceCenter,
	forceLink,
	forceManyBody,
	forceSimulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { useEffect, useRef } from "preact/hooks";
import type { TraceHop } from "../types";

interface GraphNode extends SimulationNodeDatum {
	id: string;
	sourceType: string;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
	edgeType: string;
}

const TYPE_COLORS: Record<string, string> = {
	code: "#4ade80",
	markdown: "#60a5fa",
	"github-issue": "#fb923c",
	"github-pr": "#c084fc",
	"github-pr-comment": "#e879f9",
	"doc-page": "#2dd4bf",
	"slack-message": "#facc15",
	"discord-message": "#818cf8",
};

function buildGraph(groups: Record<string, TraceHop[]>): {
	nodes: GraphNode[];
	links: GraphLink[];
} {
	const nodeMap = new Map<string, GraphNode>();
	const links: GraphLink[] = [];

	for (const hops of Object.values(groups)) {
		for (const hop of hops) {
			if (!nodeMap.has(hop.source)) {
				nodeMap.set(hop.source, { id: hop.source, sourceType: hop.sourceType });
			}
		}
	}

	// Build edges between sources that share edge-type connections
	const allHops = Object.values(groups).flat();
	const edgeHops = allHops.filter((h) => h.connection.method === "edge");

	// Connect edge hops to their neighbors in the result set
	for (let i = 0; i < edgeHops.length; i++) {
		const hop = edgeHops[i];
		if (!hop) continue;
		// Connect to the next different source in edge results
		for (let j = i + 1; j < edgeHops.length; j++) {
			const other = edgeHops[j];
			if (!other) continue;
			if (other.source !== hop.source) {
				links.push({
					source: hop.source,
					target: other.source,
					edgeType: hop.connection.edgeType ?? "references",
				});
				break;
			}
		}
	}

	// Also connect semantic hops to the nearest edge hop by source type
	const semanticHops = allHops.filter((h) => h.connection.method === "semantic");
	for (const sem of semanticHops) {
		const nearest = edgeHops.find(
			(e) => e.sourceType === sem.sourceType && e.source !== sem.source,
		);
		if (nearest) {
			links.push({
				source: sem.source,
				target: nearest.source,
				edgeType: "semantic",
			});
		}
	}

	return { nodes: [...nodeMap.values()], links };
}

interface ConnectionGraphProps {
	groups: Record<string, TraceHop[]>;
}

export function ConnectionGraph({ groups }: ConnectionGraphProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const { nodes, links } = buildGraph(groups);

	useEffect(() => {
		if (!svgRef.current || nodes.length < 3) return;

		const width = 400;
		const height = 250;
		const svg = select(svgRef.current);
		svg.selectAll("*").remove();

		svg.attr("viewBox", `0 0 ${width} ${height}`);

		const simulation = forceSimulation(nodes)
			.force(
				"link",
				forceLink<GraphNode, GraphLink>(links)
					.id((d) => d.id)
					.distance(60),
			)
			.force("charge", forceManyBody().strength(-120))
			.force("center", forceCenter(width / 2, height / 2));

		const link = svg
			.append("g")
			.selectAll("line")
			.data(links)
			.join("line")
			.attr("stroke", "#333")
			.attr("stroke-width", 1)
			.attr("stroke-dasharray", (d) => (d.edgeType === "semantic" ? "3,3" : "none"));

		const node = svg
			.append("g")
			.selectAll("circle")
			.data(nodes)
			.join("circle")
			.attr("r", 6)
			.attr("fill", (d) => TYPE_COLORS[d.sourceType] ?? "#888")
			.attr("stroke", "#000")
			.attr("stroke-width", 1);

		const label = svg
			.append("g")
			.selectAll("text")
			.data(nodes)
			.join("text")
			.text((d) => {
				const parts = d.id.split("/");
				return parts[parts.length - 1] ?? d.id;
			})
			.attr("font-size", "8px")
			.attr("fill", "#888")
			.attr("dx", 10)
			.attr("dy", 3);

		// Hover effects
		node.on("mouseover", (_event, d) => {
			const connectedIds = new Set<string>();
			connectedIds.add(d.id);
			for (const l of links) {
				const src = typeof l.source === "object" ? l.source.id : l.source;
				const tgt = typeof l.target === "object" ? l.target.id : l.target;
				if (src === d.id) connectedIds.add(tgt);
				if (tgt === d.id) connectedIds.add(src);
			}
			node.attr("opacity", (n) => (connectedIds.has(n.id) ? 1 : 0.2));
			link.attr("opacity", (l) => {
				const src = typeof l.source === "object" ? l.source.id : l.source;
				const tgt = typeof l.target === "object" ? l.target.id : l.target;
				return src === d.id || tgt === d.id ? 1 : 0.1;
			});
			label.attr("opacity", (n) => (connectedIds.has(n.id) ? 1 : 0.2));
		});

		node.on("mouseout", () => {
			node.attr("opacity", 1);
			link.attr("opacity", 1);
			label.attr("opacity", 1);
		});

		simulation.on("tick", () => {
			link
				.attr("x1", (d) => (d.source as GraphNode).x ?? 0)
				.attr("y1", (d) => (d.source as GraphNode).y ?? 0)
				.attr("x2", (d) => (d.target as GraphNode).x ?? 0)
				.attr("y2", (d) => (d.target as GraphNode).y ?? 0);

			node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);

			label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
		});

		return () => {
			simulation.stop();
		};
	}, [nodes, links]);

	if (nodes.length < 3) return null;

	return (
		<div class="connection-graph card-enter">
			<h3 style={{ fontSize: "0.85rem", marginBottom: "0.5rem", color: "var(--muted)" }}>
				Evidence Chain
			</h3>
			<svg
				ref={svgRef}
				style={{
					width: "100%",
					maxWidth: "400px",
					height: "250px",
					background: "var(--surface)",
					borderRadius: "8px",
					border: "1px solid var(--border)",
				}}
			/>
			<div style={{ fontSize: "0.7rem", color: "var(--dim)", marginTop: "0.25rem" }}>
				Solid lines = edge connections &middot; Dashed = semantic similarity
			</div>
		</div>
	);
}
