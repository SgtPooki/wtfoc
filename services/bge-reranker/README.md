# Local reranker sidecar

Cross-encoder reranker exposed as a tiny HTTP sidecar. Used by `BgeReranker` in `packages/search/src/rerankers/bge.ts`.

Runs natively (no Docker) so PyTorch can use the local accelerator — `mps` on Apple Silicon, `cuda` on nvidia hosts. Docker on Mac is CPU-only because the Docker VM cannot see the Metal GPU; this is why the prior Dockerfile was removed.

## Run it

```bash
./run-native.sh
# server listens on http://localhost:8386 by default
```

`server.py` auto-detects the device (`cuda` > `mps` > `cpu`). Health check reports which is in use:

```bash
curl http://localhost:8386/health
# {"status":"ok","model":"BAAI/bge-reranker-v2-m3","device":"mps"}
```

Override env vars:
- `PORT` — default `8386`
- `MODEL` — default `BAAI/bge-reranker-v2-m3`. Any sentence-transformers `CrossEncoder`-compatible HF id (e.g. `zeroentropy/zerank-1-small` with `trust_remote_code=True`).
- `DEVICE` — force `cpu`/`mps`/`cuda`. Default auto-detect.
- `MAX_LENGTH` — default `512` tokens.
- `MAX_CANDIDATES` — default `100` per request.

The venv is cached at `~/.cache/wtfoc-rerank-venv` (override with `WTFOC_RERANK_VENV`). First run downloads the model (~1-3GB depending on choice).

## Wiring it into wtfoc

```bash
pnpm dogfood \
  --collection <your-collection> \
  --reranker-type bge \
  --reranker-url http://localhost:8386 \
  --diversity-enforce \
  --output report.json
```

The `BgeReranker` client speaks the same protocol against any compliant `/rerank` server, including production deployments running elsewhere — point `--reranker-url` at whichever endpoint you want.

## Picking a model

`MODEL` can point at any reranker that loads via `sentence_transformers.CrossEncoder`. Some options:

- `BAAI/bge-reranker-v2-m3` (default) — XLM-RoBERTa-large, ~568M params, max_length 512.
- `zeroentropy/zerank-1-small` — Qwen3-4B fine-tune, ~1.7B params, max_length up to 32k. Apache-2.0.
- `mixedbread-ai/mxbai-rerank-base-v2`, etc.

Validate any new model against the `grader-teeth` adversarial fixture (or build an analogous rerank-teeth fixture) before treating it as production-grade.
