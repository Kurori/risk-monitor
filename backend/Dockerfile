FROM python:3.11-slim

# PySpark requires Java
RUN apt-get update && \
    apt-get install -y --no-install-recommends default-jre-headless && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all Python deps (backend + ingestion + processing)
COPY backend/requirements.txt ./backend_req.txt
COPY ingestion/requirements.txt ./ingestion_req.txt
COPY processing/requirements.txt ./processing_req.txt
RUN pip install --no-cache-dir -r backend_req.txt -r ingestion_req.txt -r processing_req.txt

# Copy source
COPY backend/ ./backend/
COPY ingestion/ ./ingestion/
COPY processing/ ./processing/
COPY config/ ./config/

WORKDIR /app/backend

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
