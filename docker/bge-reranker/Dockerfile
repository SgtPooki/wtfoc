FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the model at build time so container starts fast
ARG MODEL=BAAI/bge-reranker-v2-m3
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('${MODEL}', max_length=512)"

COPY server.py .

ENV PORT=8080
ENV MODEL=BAAI/bge-reranker-v2-m3
ENV MAX_LENGTH=512
ENV MAX_CANDIDATES=100

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"

CMD ["python", "server.py"]
