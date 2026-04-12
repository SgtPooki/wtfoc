# wtfoc Principles

Design principles that govern implementation decisions. For project vision, see [vision.md](./vision.md). For why wtfoc exists, see [why.md](./why.md).

## All Computed Data Must Be Persisted

Every feature that enriches a collection must persist its results to the manifest or segments. If a command computes something useful — themes, labels, scores, categories — that data must be stored in the collection so it travels with the CID. Ephemeral-only outputs defeat the purpose of a shareable knowledge graph.

The goal: when someone receives a collection CID, they get the full accumulated knowledge — not just raw chunks and embeddings, but every layer of analysis that any contributor has added. Themes, edge extractions, noise categorizations, signal scores — all of it persists, all of it is shareable, all of it can be extended by the next contributor.
