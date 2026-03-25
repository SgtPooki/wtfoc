/**
 * Test fixture data — small markdown documents for seeding collections.
 */

export const FIXTURE_SYNAPSE_SDK = `# Synapse SDK

The synapse-sdk provides decentralized storage on Filecoin.
It uses content-addressed data structures (CIDs) for immutable references.

## Upload API

Use \`synapse.upload(data)\` to store content on the network.
The upload returns a CID that can be used to retrieve the data later.

## Retrieval

Use \`synapse.get(cid)\` to fetch content by its CID.
Retrieval is verified — the data hash must match the CID.
`;

export const FIXTURE_FOC_CLI = `# FOC CLI

The foc-cli is a command-line tool that wraps the synapse-sdk.
It provides simple commands for interacting with Filecoin storage.

## Commands

- \`foc upload <file>\` — store a file on the network
- \`foc get <cid>\` — retrieve a file by CID
- \`foc status\` — check network connectivity

## Configuration

Set \`FOC_GATEWAY\` environment variable to use a custom gateway.
`;

export const FIXTURE_KNOWLEDGE_BASE = `# Knowledge Base Architecture

A knowledge base is a structured collection of documents
that can be searched semantically using vector embeddings.

## Ingestion Pipeline

1. Parse source documents into chunks
2. Generate embeddings for each chunk
3. Store chunks and embeddings in a segment
4. Update the collection manifest

## Query Flow

1. Embed the query text
2. Find nearest neighbors in the vector index
3. Return ranked results with scores
`;
