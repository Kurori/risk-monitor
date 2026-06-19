"""PySpark batch job — reads raw data from MongoDB, computes risk scores, writes results back.

Architecture note: We use pymongo for MongoDB I/O and PySpark for the computation layer.
At production scale this would use the MongoDB Spark Connector for parallel reads.
"""

import logging
import os
from datetime import datetime, timezone, timedelta

from pymongo import MongoClient, UpdateOne
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (
    DoubleType,
    StringType,
    ArrayType,
    IntegerType,
    StructType,
    StructField,
)
from pyspark.sql.window import Window

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("risk_processor")

SEVERITY_WEIGHTS = {"CRITICAL": 10, "HIGH": 7, "MEDIUM": 4, "LOW": 1, "UNKNOWN": 2}


# ---------------------------------------------------------------------------
# Spark UDFs
# ---------------------------------------------------------------------------

@F.udf(returnType=DoubleType())
def commit_trend_score(commits: list) -> float:
    """Score 0–100 (higher = riskier) based on commit volume and trend direction."""
    if not commits:
        return 80.0
    recent = [c for c in commits if c is not None][-52:]
    n = len(recent)
    if n < 4:
        return 80.0

    mean_x = (n - 1) / 2.0
    mean_y = sum(recent) / n

    num = sum((i - mean_x) * (y - mean_y) for i, y in enumerate(recent))
    den = sum((i - mean_x) ** 2 for i in range(n))
    slope = num / den if den != 0 else 0.0

    # Trend component (0–50): declining trend raises risk
    # A slope of -1 commit/week maps to ~10 risk points
    trend_component = min(50.0, max(0.0, 25.0 - slope * 5.0))

    # Activity component (0–50): very low average activity raises risk
    avg = mean_y
    if avg >= 100:
        activity_component = 0.0
    elif avg <= 0:
        activity_component = 50.0
    else:
        activity_component = 50.0 * (1.0 - min(avg, 100.0) / 100.0)

    return round(trend_component + activity_component, 2)


@F.udf(returnType=DoubleType())
def cve_score(severities: list) -> float:
    """Score 0–100 based on count and severity of known CVEs."""
    if not severities:
        return 0.0
    weights = {"CRITICAL": 10, "HIGH": 7, "MEDIUM": 4, "LOW": 1, "UNKNOWN": 2}
    total = sum(weights.get(str(s).upper(), 2) for s in severities)
    return round(min(100.0, total * 4.0), 2)


@F.udf(returnType=StringType())
def risk_level(score: float) -> str:
    if score is None:
        return "UNKNOWN"
    if score >= 75:
        return "CRITICAL"
    if score >= 50:
        return "HIGH"
    if score >= 25:
        return "MEDIUM"
    return "LOW"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_spark() -> SparkSession:
    return (
        SparkSession.builder.master("local[*]")
        .appName("TechStackRiskProcessor")
        .config("spark.driver.memory", "2g")
        .config("spark.sql.shuffle.partitions", "8")
        .getOrCreate()
    )


def load_commits(db) -> list[dict]:
    return list(db.commit_weekly.find({}, {"_id": 0, "package_name": 1, "week": 1, "commits": 1}))


def load_vulnerabilities(db) -> list[dict]:
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=730)  # last 2 years
    return list(
        db.vulnerabilities.find(
            {"published": {"$gte": cutoff}},
            {"_id": 0, "package_name": 1, "severity": 1, "vuln_id": 1, "cvss_score": 1, "summary": 1, "published": 1},
        )
    )


def load_packages(db) -> list[dict]:
    return list(db.packages.find({}, {"_id": 0}))


def compute_scores(spark: SparkSession, commits_raw: list, vulns_raw: list, packages_raw: list) -> list[dict]:
    # --- Commit DataFrame ---
    commit_schema = StructType([
        StructField("package_name", StringType()),
        StructField("commits", IntegerType()),
    ])
    if commits_raw:
        commits_flat = [{"package_name": r["package_name"], "commits": int(r.get("commits", 0))} for r in commits_raw]
        commits_df = spark.createDataFrame(commits_flat, schema=commit_schema)
    else:
        commits_df = spark.createDataFrame([], schema=commit_schema)

    # Collect weekly commit arrays per package (ordered by week)
    sorted_commits = sorted(commits_raw, key=lambda r: r.get("week", datetime.min.replace(tzinfo=timezone.utc)))
    from collections import defaultdict
    pkg_commits: dict[str, list] = defaultdict(list)
    for r in sorted_commits:
        pkg_commits[r["package_name"]].append(int(r.get("commits", 0)))

    commit_array_rows = [{"package_name": k, "weekly_commits": v} for k, v in pkg_commits.items()]
    commit_array_schema = StructType([
        StructField("package_name", StringType()),
        StructField("weekly_commits", ArrayType(IntegerType())),
    ])
    if commit_array_rows:
        commit_arrays_df = spark.createDataFrame(commit_array_rows, schema=commit_array_schema)
    else:
        commit_arrays_df = spark.createDataFrame([], schema=commit_array_schema)

    commit_arrays_df = commit_arrays_df.withColumn(
        "commit_trend_score", commit_trend_score(F.col("weekly_commits"))
    )

    # --- Vulnerability DataFrame ---
    vuln_schema = StructType([
        StructField("package_name", StringType()),
        StructField("severity", StringType()),
        StructField("vuln_id", StringType()),
        StructField("cvss_score", DoubleType()),
        StructField("summary", StringType()),
    ])
    if vulns_raw:
        vulns_flat = [
            {
                "package_name": v["package_name"],
                "severity": v.get("severity", "UNKNOWN"),
                "vuln_id": v.get("vuln_id", ""),
                "cvss_score": float(v.get("cvss_score", 0) or 0),
                "summary": v.get("summary", ""),
            }
            for v in vulns_raw
        ]
        vulns_df = spark.createDataFrame(vulns_flat, schema=vuln_schema)
    else:
        vulns_df = spark.createDataFrame([], schema=vuln_schema)

    vuln_agg_df = vulns_df.groupBy("package_name").agg(
        F.collect_list("severity").alias("severities"),
        F.count("vuln_id").alias("cve_count"),
    )
    vuln_agg_df = vuln_agg_df.withColumn("cve_score", cve_score(F.col("severities")))

    # --- Package base DataFrame ---
    pkg_schema = StructType([
        StructField("package_name", StringType()),
        StructField("ecosystem", StringType()),
        StructField("stars", IntegerType()),
        StructField("archived", StringType()),
    ])
    pkg_rows = [
        {
            "package_name": p["name"],
            "ecosystem": p.get("ecosystem", ""),
            "stars": int(p.get("stars", 0) or 0),
            "archived": str(p.get("archived", False)),
        }
        for p in packages_raw
    ]
    if pkg_rows:
        pkg_df = spark.createDataFrame(pkg_rows, schema=pkg_schema)
    else:
        pkg_df = spark.createDataFrame([], schema=pkg_schema)

    # --- Join ---
    scores_df = (
        pkg_df
        .join(commit_arrays_df, on="package_name", how="left")
        .join(vuln_agg_df, on="package_name", how="left")
        .fillna({"commit_trend_score": 80.0, "cve_score": 0.0, "cve_count": 0})
    )

    scores_df = scores_df.withColumn(
        "composite_score",
        F.round(F.col("commit_trend_score") * 0.4 + F.col("cve_score") * 0.6, 2),
    ).withColumn(
        "risk_level", risk_level(F.col("composite_score"))
    )

    return scores_df.collect()


def write_scores(db, rows, vulns_raw: list) -> None:
    now = datetime.now(tz=timezone.utc)

    vuln_by_pkg: dict[str, list] = {}
    for v in vulns_raw:
        vuln_by_pkg.setdefault(v["package_name"], []).append(
            {
                "vuln_id": v.get("vuln_id", ""),
                "severity": v.get("severity", "UNKNOWN"),
                "cvss_score": float(v.get("cvss_score", 0) or 0),
                "summary": v.get("summary", ""),
                "published": v.get("published"),
            }
        )

    ops = []
    for row in rows:
        name = row["package_name"]
        weekly = list(row["weekly_commits"]) if row["weekly_commits"] else []
        ops.append(
            UpdateOne(
                {"package_name": name},
                {
                    "$set": {
                        "package_name": name,
                        "ecosystem": row["ecosystem"],
                        "stars": row["stars"],
                        "archived": row["archived"] == "True",
                        "commit_trend_score": float(row["commit_trend_score"] or 80),
                        "cve_score": float(row["cve_score"] or 0),
                        "composite_score": float(row["composite_score"] or 0),
                        "risk_level": row["risk_level"],
                        "cve_count": int(row["cve_count"] or 0),
                        "weekly_commits": weekly,
                        "cves": vuln_by_pkg.get(name, []),
                        "computed_at": now,
                    }
                },
                upsert=True,
            )
        )

    if ops:
        db.risk_scores.bulk_write(ops)
        logger.info("Wrote %d risk score records", len(ops))


def main():
    mongodb_url = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    client = MongoClient(mongodb_url)
    db = client.risk_monitor

    logger.info("Loading data from MongoDB...")
    commits_raw = load_commits(db)
    vulns_raw = load_vulnerabilities(db)
    packages_raw = load_packages(db)
    logger.info(
        "Loaded %d commit records, %d vulnerabilities, %d packages",
        len(commits_raw), len(vulns_raw), len(packages_raw),
    )

    if not packages_raw:
        logger.error("No packages found in MongoDB. Run ingestion first.")
        return

    logger.info("Starting Spark session (local mode)...")
    spark = build_spark()
    spark.sparkContext.setLogLevel("WARN")

    logger.info("Computing risk scores with PySpark...")
    rows = compute_scores(spark, commits_raw, vulns_raw, packages_raw)
    logger.info("Computed scores for %d packages", len(rows))

    write_scores(db, rows, vulns_raw)
    spark.stop()
    logger.info("Processing complete.")


if __name__ == "__main__":
    main()
