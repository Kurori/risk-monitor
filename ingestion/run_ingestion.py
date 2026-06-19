"""Main ingestion entry point — reads packages.yaml, calls GitHub + OSV, writes to MongoDB."""

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
from pymongo import MongoClient, UpdateOne

from github_ingester import fetch_commit_activity, fetch_repo_meta
from cve_ingester import fetch_vulnerabilities

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ingestion")


def load_packages(config_path: str) -> list[dict]:
    with open(config_path) as f:
        return yaml.safe_load(f)["packages"]


def ingest_package(db, pkg: dict) -> None:
    name = pkg["name"]
    github = pkg.get("github") or f"{pkg['github_owner']}/{pkg['github_repo']}"
    owner, repo = github.split("/", 1)
    logger.info("Ingesting %s (%s/%s)", name, owner, repo)

    meta = fetch_repo_meta(owner, repo)
    db.packages.update_one(
        {"name": name},
        {
            "$set": {
                "name": name,
                "github": f"{owner}/{repo}",
                "ingested_at": datetime.now(tz=timezone.utc),
                **meta,
            }
        },
        upsert=True,
    )

    # Weekly commit activity (52 weeks)
    weekly = fetch_commit_activity(owner, repo)
    if weekly:
        ops = [
            UpdateOne(
                {"package_name": name, "week": w["week"]},
                {"$set": {"package_name": name, "commits": w["commits"], "week": w["week"]}},
                upsert=True,
            )
            for w in weekly
        ]
        db.commit_weekly.bulk_write(ops)
        logger.info("  Stored %d weekly commit records for %s", len(ops), name)

    # CVE / vulnerability data
    vulns = fetch_vulnerabilities(name, f"{owner}/{repo}")
    if vulns:
        ops = [
            UpdateOne(
                {"vuln_id": v["vuln_id"]},
                {
                    "$set": {
                        **v,
                        "ingested_at": datetime.now(tz=timezone.utc),
                    }
                },
                upsert=True,
            )
            for v in vulns
        ]
        db.vulnerabilities.bulk_write(ops)
        logger.info("  Stored %d vulnerabilities for %s", len(ops), name)
    else:
        logger.info("  No vulnerabilities found for %s", name)


def main():
    mongodb_url = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    config_path = os.getenv("CONFIG_PATH", "/app/config/packages.yaml")

    if not Path(config_path).exists():
        # Try relative path (for local dev)
        config_path = Path(__file__).parent.parent / "config" / "packages.yaml"

    client = MongoClient(mongodb_url)
    db = client.risk_monitor

    # Ensure indexes
    db.commit_weekly.create_index([("package_name", 1), ("week", 1)], unique=True)
    db.vulnerabilities.create_index("vuln_id", unique=True)
    db.packages.create_index("name", unique=True)

    packages = load_packages(str(config_path))
    logger.info("Starting ingestion for %d packages", len(packages))

    failed = []
    for pkg in packages:
        try:
            ingest_package(db, pkg)
        except Exception as exc:
            logger.error("Failed to ingest %s: %s", pkg["name"], exc)
            failed.append(pkg["name"])

    if failed:
        logger.warning("Failed packages: %s", failed)
        sys.exit(1)

    logger.info("Ingestion complete.")


if __name__ == "__main__":
    main()
