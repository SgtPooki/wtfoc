#!/usr/bin/env bash
set -euo pipefail

# Run the BGE reranker sidecar NATIVELY (outside Docker) so PyTorch
# can use the local accelerator (MPS on Apple Silicon, CUDA on
# nvidia hosts). The Docker container runs CPU-only on Mac because
# Docker on Mac cannot see the Metal GPU.
#
# Default port is 8386 to avoid clashing with the Docker container's
# 8385 mapping. Override with PORT=... ./run-native.sh.
#
# After it starts, point the wtfoc reranker client at it:
#
#   pnpm dogfood ... --reranker-type bge --reranker-url http://localhost:8386
#
# To use a different model:
#
#   MODEL=zeroentropy/zerank-1-small ./run-native.sh
#
# To force CPU even with a GPU available (debugging):
#
#   DEVICE=cpu ./run-native.sh
#
# Press Ctrl-C to stop. The venv is cached under ~/.cache/wtfoc-rerank-venv
# so subsequent starts skip dependency install.

HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="${WTFOC_RERANK_VENV:-$HOME/.cache/wtfoc-rerank-venv}"
PORT="${PORT:-8386}"
MODEL="${MODEL:-BAAI/bge-reranker-v2-m3}"

if [ ! -d "$VENV" ]; then
  echo "[run-native] Creating venv at $VENV"
  python3 -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

# Always install requirements (pip is idempotent — skips when
# already-satisfied). Keeps the venv in sync if requirements.txt
# changes between runs.
pip install --quiet --disable-pip-version-check -r "$HERE/requirements.txt"

echo "[run-native] starting server.py PORT=$PORT MODEL=$MODEL"
PORT="$PORT" MODEL="$MODEL" exec python "$HERE/server.py"
