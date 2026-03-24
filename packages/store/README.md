# @wtfoc/store

Storage backends and collection management for [wtfoc](https://github.com/SgtPooki/wtfoc).

## Install

```bash
npm install @wtfoc/store
```

## What It Does

- **Local storage** — file-system-backed content-addressed store for development and single-machine use
- **FOC storage** — publish collections to [Filecoin Onchain Cloud](https://docs.filecoin.cloud) for verifiable, decentralized persistence
- **Collection management** — create, version, and diff collections with deterministic IDs
- **Bundle & upload** — pack segments into CAR files and upload via any `StorageBackend`
- **CID verification** — verify content integrity against stored CIDs

## Usage

```typescript
import { createStore, generateCollectionId, bundleAndUpload } from '@wtfoc/store';

// Create a local store
const store = createStore({ storage: 'local' });

// Generate a deterministic collection ID
const id = generateCollectionId('my-collection', 'my-namespace');
```

## Related Packages

- [`@wtfoc/common`](../common/) — Interfaces this package implements (`StorageBackend`, `ManifestStore`)
- [`@wtfoc/ingest`](../ingest/) — Produces segments that this package stores
- [`@wtfoc/search`](../search/) — Mounts stored collections for querying

## License

MIT
