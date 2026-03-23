# Quickstart: Collection Revisions and Provenance

## Goal

Publish a collection to FOC, create multiple revisions, inspect what changed, and mount the collection elsewhere without re-embedding the full corpus.

## Example Flow

1. Create a collection

```bash
wtfoc init team-intel --storage foc
```

2. Ingest source material

```bash
wtfoc ingest slack ./exports/support.json --collection team-intel
wtfoc ingest github FilOzone/synapse-sdk --collection team-intel
```

3. Publish the current collection state

```bash
wtfoc publish --collection team-intel
```

Expected outcome:

- collection descriptor exists
- collection head points at the new revision
- revision artifact references ingest-produced segment bundles

4. Publish a later revision after new ingest

```bash
wtfoc ingest github FilOzone/curio --collection team-intel
wtfoc publish --collection team-intel
```

5. Inspect the latest collection state

```bash
wtfoc collection show --collection team-intel
```

6. Diff two revisions

```bash
wtfoc collection diff --collection team-intel --from <rev-a> --to <rev-b>
```

7. Mount from a revision handle in another environment

```bash
wtfoc mount <revision-id>
wtfoc query "upload failures" --collection team-intel
wtfoc trace "upload failures" --collection team-intel
```

Expected behavior:

- query reuses stored corpus embeddings
- trace can follow explicit stored edges
- only query-time embedding is needed when semantic search is used
