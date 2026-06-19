"""FastAPI backend — serves risk score data and streams real-time CVE alerts via WebSocket."""

import asyncio
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bson import ObjectId
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backend")

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")

app = FastAPI(title="Tech Stack Risk Monitor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------

_client: AsyncIOMotorClient | None = None

def get_db():
    return _client.risk_monitor  # type: ignore[union-attr]


@app.on_event("startup")
async def startup():
    global _client
    _client = AsyncIOMotorClient(MONGODB_URL)
    asyncio.create_task(_alert_stream())
    logger.info("Connected to MongoDB at %s", MONGODB_URL)


@app.on_event("shutdown")
async def shutdown():
    if _client:
        _client.close()


# ---------------------------------------------------------------------------
# WebSocket alert manager
# ---------------------------------------------------------------------------

class _AlertManager:
    def __init__(self):
        self._conns: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._conns.append(ws)

    def disconnect(self, ws: WebSocket):
        self._conns.discard(ws) if hasattr(self._conns, "discard") else None
        if ws in self._conns:
            self._conns.remove(ws)

    async def broadcast(self, msg: dict):
        dead = []
        for ws in list(self._conns):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


_alerts = _AlertManager()


async def _alert_stream():
    """Poll MongoDB for newly ingested vulnerabilities and push alerts to connected clients.

    In production this would be replaced by a MongoDB Change Stream (replica set required)
    or a Kafka consumer connected to a Spark Structured Streaming job.
    """
    last_seen = datetime.now(tz=timezone.utc)
    while True:
        await asyncio.sleep(30)
        try:
            db = get_db()
            cursor = db.vulnerabilities.find(
                {"ingested_at": {"$gt": last_seen}},
                {"_id": 0, "vuln_id": 1, "package_name": 1, "severity": 1, "summary": 1},
            ).limit(50)
            docs = await cursor.to_list(length=50)
            if docs:
                last_seen = datetime.now(tz=timezone.utc)
                for doc in docs:
                    await _alerts.broadcast({"type": "new_vulnerability", **doc})
        except Exception as exc:
            logger.warning("Alert stream error: %s", exc)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean(doc: dict) -> dict:
    doc.pop("_id", None)
    for k, v in doc.items():
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
        elif isinstance(v, ObjectId):
            doc[k] = str(v)
    return doc


def _clean_list(docs: list[dict]) -> list[dict]:
    for doc in docs:
        _clean(doc)
        for cve in doc.get("cves", []):
            if isinstance(cve.get("published"), datetime):
                cve["published"] = cve["published"].isoformat()
    return docs


# ---------------------------------------------------------------------------
# Pipeline control
# ---------------------------------------------------------------------------

_pipeline_status: dict[str, Any] = {"ingestion": "idle", "processing": "idle", "pipeline": "idle"}


def _run_script(script_path: str, env_key: str) -> bool:
    """Run a script as a subprocess. Returns True on success."""
    _pipeline_status[env_key] = "running"
    try:
        result = subprocess.run(
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            cwd=str(Path(script_path).parent),
            env={**os.environ, "MONGODB_URL": MONGODB_URL},
        )
        if result.returncode == 0:
            _pipeline_status[env_key] = "done"
            return True
        else:
            _pipeline_status[env_key] = f"error: {result.stderr[-300:]}"
            logger.error("%s failed:\n%s", script_path, result.stderr[-500:])
            return False
    except Exception as exc:
        _pipeline_status[env_key] = f"error: {exc}"
        logger.error("%s failed: %s", script_path, exc)
        return False


def _resolve_script(container_path: str, relative_parts: tuple) -> Path:
    p = Path(container_path)
    if not p.exists():
        p = Path(__file__).parent.parent.joinpath(*relative_parts)
    return p


def _run_pipeline():
    """Run ingestion then processing sequentially in a background thread."""
    _pipeline_status["pipeline"] = "running"
    ingest_script = _resolve_script("/app/ingestion/run_ingestion.py", ("ingestion", "run_ingestion.py"))
    process_script = _resolve_script("/app/processing/risk_processor.py", ("processing", "risk_processor.py"))

    ok = _run_script(str(ingest_script), "ingestion")
    if ok:
        _run_script(str(process_script), "processing")
    _pipeline_status["pipeline"] = (
        "done" if _pipeline_status["processing"] == "done" else _pipeline_status["processing"]
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/packages")
async def list_packages():
    db = get_db()
    docs = await db.risk_scores.find({}).sort("composite_score", -1).to_list(length=200)
    return _clean_list(docs)


@app.get("/api/packages/{name}")
async def get_package(name: str):
    db = get_db()
    doc = await db.risk_scores.find_one({"package_name": name})
    if not doc:
        raise HTTPException(status_code=404, detail="Package not found")
    return _clean(doc)


@app.post("/api/pipeline/run")
async def trigger_pipeline(background_tasks: BackgroundTasks):
    if _pipeline_status["pipeline"] == "running":
        return {"status": "already_running"}
    background_tasks.add_task(_run_pipeline)
    return {"status": "started"}


@app.post("/api/pipeline/ingest")
async def trigger_ingest(background_tasks: BackgroundTasks):
    if _pipeline_status["ingestion"] == "running":
        return {"status": "already_running"}
    script = _resolve_script("/app/ingestion/run_ingestion.py", ("ingestion", "run_ingestion.py"))
    background_tasks.add_task(_run_script, str(script), "ingestion")
    return {"status": "started"}


@app.post("/api/pipeline/process")
async def trigger_process(background_tasks: BackgroundTasks):
    if _pipeline_status["processing"] == "running":
        return {"status": "already_running"}
    script = _resolve_script("/app/processing/risk_processor.py", ("processing", "risk_processor.py"))
    background_tasks.add_task(_run_script, str(script), "processing")
    return {"status": "started"}


@app.get("/api/pipeline/status")
async def pipeline_status():
    return _pipeline_status


@app.get("/api/stats")
async def global_stats():
    db = get_db()
    total = await db.risk_scores.count_documents({})
    critical = await db.risk_scores.count_documents({"risk_level": "CRITICAL"})
    high = await db.risk_scores.count_documents({"risk_level": "HIGH"})
    total_cves = await db.vulnerabilities.count_documents({})
    return {
        "total_packages": total,
        "critical": critical,
        "high": high,
        "total_cves": total_cves,
    }


@app.websocket("/ws/alerts")
async def ws_alerts(websocket: WebSocket):
    await _alerts.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        _alerts.disconnect(websocket)


@app.get("/healthz")
async def health():
    return {"status": "ok"}
