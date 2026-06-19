"""Fetch weekly commit stats and repo metadata from GitHub API."""

import os
import time
import logging
from datetime import datetime, timezone

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

logger = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com"


def _headers() -> dict:
    token = os.getenv("GITHUB_TOKEN", "")
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=2, min=4, max=60),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
)
def _get(client: httpx.Client, url: str) -> dict | list | None:
    resp = client.get(url, headers=_headers(), timeout=30)
    if resp.status_code == 202:
        # GitHub is still computing stats — caller should retry
        return None
    if resp.status_code == 404:
        logger.warning("Not found: %s", url)
        return None
    resp.raise_for_status()
    return resp.json()


def fetch_commit_activity(owner: str, repo: str) -> list[dict]:
    """Return up to 52 weekly commit records for the repo.

    Each record: {"week": datetime, "commits": int}
    """
    url = f"{GITHUB_API}/repos/{owner}/{repo}/stats/commit_activity"
    with httpx.Client() as client:
        for attempt in range(5):
            data = _get(client, url)
            if data is not None:
                break
            logger.info("GitHub still computing stats for %s/%s, waiting...", owner, repo)
            time.sleep(10 * (attempt + 1))
        else:
            logger.warning("Could not fetch commit activity for %s/%s", owner, repo)
            return []

    return [
        {
            "week": datetime.fromtimestamp(w["week"], tz=timezone.utc),
            "commits": w["total"],
        }
        for w in data
    ]


def fetch_repo_meta(owner: str, repo: str) -> dict:
    url = f"{GITHUB_API}/repos/{owner}/{repo}"
    with httpx.Client() as client:
        data = _get(client, url)
    if not data:
        return {}
    return {
        "stars": data.get("stargazers_count", 0),
        "forks": data.get("forks_count", 0),
        "open_issues": data.get("open_issues_count", 0),
        "language": data.get("language", ""),
        "archived": data.get("archived", False),
    }
