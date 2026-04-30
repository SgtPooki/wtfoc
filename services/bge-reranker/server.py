#!/usr/bin/env python3
"""
Minimal HTTP reranker sidecar using BAAI/bge-reranker-v2-m3.
Exposes:
  POST /rerank  — score query-document pairs
  GET  /health  — liveness check
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

PORT = int(os.environ.get("PORT", "8080"))
MODEL_NAME = os.environ.get("MODEL", "BAAI/bge-reranker-v2-m3")
MAX_LENGTH = int(os.environ.get("MAX_LENGTH", "512"))
MAX_CANDIDATES = int(os.environ.get("MAX_CANDIDATES", "100"))

# Device auto-detect — `DEVICE` env override > CUDA > MPS (Apple Silicon
# Metal GPU) > CPU. Docker on Linux+nvidia hits CUDA. Native python on
# Apple Silicon hits MPS — orders of magnitude faster than the CPU-only
# Docker path on Mac (Docker can't see the Metal GPU). Native run via
# run-native.sh.
import torch  # noqa: E402

DEVICE = os.environ.get("DEVICE", "").strip()
if not DEVICE:
    if torch.cuda.is_available():
        DEVICE = "cuda"
    elif torch.backends.mps.is_available():
        DEVICE = "mps"
    else:
        DEVICE = "cpu"

print(f"[bge-reranker] Loading model {MODEL_NAME} on device={DEVICE} ...", flush=True)

from sentence_transformers import CrossEncoder  # noqa: E402

model = CrossEncoder(MODEL_NAME, max_length=MAX_LENGTH, device=DEVICE)

print(f"[bge-reranker] Model loaded on {DEVICE}. Listening on :{PORT}", flush=True)


def rerank(query: str, candidates: list[dict], top_n: int | None) -> list[dict]:
    if not candidates:
        return []

    pairs = [(query, c["text"][:2000]) for c in candidates]
    scores: list[float] = model.predict(pairs).tolist()

    results = [
        {"id": c["id"], "score": float(s)}
        for c, s in zip(candidates, scores)
    ]
    results.sort(key=lambda r: r["score"], reverse=True)

    if top_n is not None:
        results = results[:top_n]

    return results


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:  # silence access log
        pass

    def _send_json(self, status: int, data: Any) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "model": MODEL_NAME, "device": DEVICE})
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/rerank":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            raw = self._read_body()
            body = json.loads(raw)
        except Exception as e:
            self._send_json(400, {"error": f"Invalid JSON: {e}"})
            return

        query = body.get("query")
        candidates = body.get("candidates", [])
        top_n = body.get("top_n")

        if not isinstance(query, str) or not query:
            self._send_json(400, {"error": "Missing required field: query"})
            return
        if not isinstance(candidates, list):
            self._send_json(400, {"error": "candidates must be a list"})
            return
        if len(candidates) > MAX_CANDIDATES:
            self._send_json(400, {"error": f"Too many candidates (max {MAX_CANDIDATES})"})
            return

        try:
            results = rerank(query, candidates, top_n)
            self._send_json(200, {"results": results})
        except Exception as e:
            print(f"[bge-reranker] Error: {e}", file=sys.stderr, flush=True)
            self._send_json(500, {"error": str(e)})


if __name__ == "__main__":
    server = HTTPServer(("", PORT), Handler)
    print(f"[bge-reranker] Ready on :{PORT}", flush=True)
    server.serve_forever()
