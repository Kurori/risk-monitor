"""Fetch vulnerability data from OSV.dev for a given package across all ecosystems."""

import functools
import logging
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

OSV_API = "https://api.osv.dev/v1"
ECOSYSTEMS_URL = "https://storage.googleapis.com/osv-vulnerabilities/ecosystems.txt"

SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]


@functools.lru_cache(maxsize=1)
def fetch_ecosystems() -> tuple[str, ...]:
    """Fetch the canonical ecosystem list from OSV (cached for the process lifetime)."""
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.get(ECOSYSTEMS_URL)
            resp.raise_for_status()
        return tuple(
            line.strip()
            for line in resp.text.splitlines()
            if line.strip() and not line.startswith("[")
        )
    except httpx.HTTPError as exc:
        logger.warning("Failed to fetch ecosystems list: %s", exc)
        return ()


def _cvss_to_severity(score: float) -> str:
    if score >= 9.0:
        return "CRITICAL"
    if score >= 7.0:
        return "HIGH"
    if score >= 4.0:
        return "MEDIUM"
    return "LOW"


def _extract_severity(vuln: dict) -> tuple[str, float]:
    """Return (severity_label, cvss_score) from an OSV vulnerability object."""
    for sev in vuln.get("severity", []):
        if sev.get("type", "").startswith("CVSS"):
            try:
                score = float(sev["score"])
                return _cvss_to_severity(score), score
            except (ValueError, KeyError):
                pass
    severity_str = (
        vuln.get("database_specific", {}).get("severity", "")
        or vuln.get("affected", [{}])[0].get("database_specific", {}).get("severity", "")
        if vuln.get("affected")
        else ""
    )
    severity_str = severity_str.upper()
    if severity_str in SEVERITY_ORDER:
        return severity_str, 0.0
    return "UNKNOWN", 0.0


def fetch_vulnerabilities(package_name: str, github_slug: str = "") -> list[dict]:
    """Query OSV.dev across every known ecosystem for both name variants.

    Tries both `package_name` and the full `owner/repo` slug so packages
    registered under either form are found.
    """
    ecosystems = fetch_ecosystems()
    if not ecosystems:
        return []

    # Build deduplicated name variants preserving insertion order
    names: list[str] = [package_name]
    if github_slug and "/" in github_slug and github_slug != package_name:
        names.append(github_slug)

    seen: set[str] = set()
    vulns: list[dict] = []

    with httpx.Client(timeout=30) as client:
        for ecosystem in ecosystems:
            for name in names:
                payload = {"package": {"name": name, "ecosystem": ecosystem}}
                try:
                    resp = client.post(f"{OSV_API}/query", json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                except httpx.HTTPError as exc:
                    logger.warning("OSV query failed for %s/%s: %s", ecosystem, name, exc)
                    continue

                for vuln in data.get("vulns", []):
                    vuln_id = vuln.get("id", "")
                    if not vuln_id or vuln_id in seen:
                        continue
                    seen.add(vuln_id)

                    severity, cvss_score = _extract_severity(vuln)
                    published_str = vuln.get("published", "")
                    try:
                        published_dt = datetime.fromisoformat(
                            published_str.rstrip("Z")
                        ).replace(tzinfo=timezone.utc)
                    except (ValueError, AttributeError):
                        published_dt = datetime.now(tz=timezone.utc)

                    aliases = vuln.get("aliases", [])
                    cve_id = next((a for a in aliases if a.startswith("CVE-")), None)
                    url = (
                        f"https://nvd.nist.gov/vuln/detail/{cve_id}"
                        if cve_id
                        else f"https://osv.dev/vulnerability/{vuln_id}"
                    )

                    vulns.append(
                        {
                            "vuln_id": vuln_id,
                            "cve_id": cve_id,
                            "url": url,
                            "package_name": package_name,
                            "ecosystem": ecosystem,
                            "matched_name": name,
                            "severity": severity,
                            "cvss_score": cvss_score,
                            "published": published_dt,
                            "summary": vuln.get("summary", "")[:500],
                        }
                    )

    logger.info(
        "  OSV scan (%d ecosystems × %d names): %d unique vulns for %s",
        len(ecosystems),
        len(names),
        len(vulns),
        package_name,
    )
    return vulns
