"""
GitHub Discussions ingestion via GraphQL API.

Fetches discussion titles, body content, AND comments (including accepted
answers) from a repository. Requires GITHUB_TOKEN with read access.
Repository must have Discussions enabled.
"""

import asyncio
import logging
import re
import uuid

import httpx
from qdrant_client.models import PointStruct, Filter, FieldCondition, MatchValue

from app.core.config import get_settings
from app.core.qdrant_client import get_qdrant
from app.ingestion.embedder import get_embeddings
from app.models.db import Source

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200
MAX_PAGES = 50
GITHUB_GRAPHQL = "https://api.github.com/graphql"

GRAPHQL_QUERY = """
query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    discussions(first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        body
        url
        createdAt
        comments(first: 50) {
          nodes {
            body
            isAnswer
            author { login }
          }
        }
      }
    }
  }
  rateLimit { remaining resetAt }
}
"""


def _parse_repo_url(url: str) -> tuple[str, str] | None:
    url = url.strip().rstrip("/")
    if "github.com/" in url:
        parts = url.split("github.com/")[-1].split("/")
        if len(parts) >= 2:
            return parts[0], parts[1]
    return None


def _chunk_text(text: str) -> list[str]:
    text = re.sub(r'\n{3,}', '\n\n', text)
    paragraphs = text.split("\n\n")
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(current) + len(para) > CHUNK_SIZE and current:
            chunks.append(current.strip())
            overlap = current[-CHUNK_OVERLAP:] if len(current) > CHUNK_OVERLAP else current
            current = overlap + "\n\n" + para
        else:
            current = current + "\n\n" + para if current else para
    if current.strip():
        chunks.append(current.strip())
    return [c for c in chunks if len(c) > 20]


def _build_discussion_text(node: dict) -> str | None:
    """Build full text from a discussion node including comments."""
    title = node.get("title", "")
    body = (node.get("body") or "").strip()

    if not body:
        return None

    text = f"# {title}\n\n{body}"

    comment_nodes = node.get("comments", {}).get("nodes", [])
    if comment_nodes:
        parts: list[str] = []
        for c in comment_nodes:
            c_body = (c.get("body") or "").strip()
            if not c_body:
                continue
            author = c.get("author", {}).get("login", "unknown") if c.get("author") else "unknown"
            prefix = "Accepted Answer" if c.get("isAnswer") else "Comment"
            parts.append(f"**{prefix} by {author}:**\n{c_body}")
        if parts:
            text += "\n\n---\n\n" + "\n\n".join(parts)

    return text


async def ingest_github_discussions(source: Source, access_token: str | None = None) -> int:
    if not source.url:
        raise ValueError("GitHub Discussions source requires a repository URL")

    settings = get_settings()
    token = access_token or getattr(settings, "GITHUB_TOKEN", None) or getattr(settings, "GITHUB_API_TOKEN", None)
    if not token:
        raise ValueError(
            "GitHub is not connected. Connect GitHub in Workspace Integrations, or set GITHUB_TOKEN in the backend."
        )

    parsed = _parse_repo_url(source.url)
    if not parsed:
        raise ValueError("Invalid GitHub repository URL. Use format https://github.com/owner/repo")

    owner, repo = parsed

    all_nodes: list[dict] = []
    cursor = None
    page_count = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        while page_count < MAX_PAGES:
            page_count += 1
            variables: dict = {"owner": owner, "repo": repo}
            if cursor:
                variables["cursor"] = cursor

            resp = await client.post(
                GITHUB_GRAPHQL,
                json={"query": GRAPHQL_QUERY, "variables": variables},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )

            if resp.status_code == 401:
                raise ValueError("GitHub token is invalid or expired.")
            if resp.status_code == 403:
                raise ValueError("Token lacks required permissions for this repository.")
            if resp.status_code == 404:
                raise ValueError("Repository not found.")
            if resp.status_code != 200:
                raise ValueError(f"GitHub API returned {resp.status_code}: {resp.text[:200]}")

            data = resp.json()
            if "errors" in data:
                raise ValueError(
                    data["errors"][0].get("message", str(data["errors"]))
                ) from None

            rate = data.get("data", {}).get("rateLimit", {})
            remaining = rate.get("remaining", 999)
            if remaining < 100:
                logger.warning(
                    "GitHub rate limit low: %d remaining, resets at %s",
                    remaining, rate.get("resetAt"),
                )

            repo_data = data.get("data", {}).get("repository")
            if not repo_data:
                raise ValueError("Repository not found or access denied.")

            discussions = repo_data.get("discussions", {})
            nodes = discussions.get("nodes", [])
            all_nodes.extend(nodes)

            page_info = discussions.get("pageInfo", {})
            if not page_info.get("hasNextPage"):
                break
            cursor = page_info.get("endCursor")
            if not cursor:
                break
        else:
            logger.warning("Hit MAX_PAGES limit (%d) for %s/%s", MAX_PAGES, owner, repo)

    if not all_nodes:
        raise ValueError("No discussions found in this repository.")

    all_chunks: list[dict] = []
    for node in all_nodes:
        number = node.get("number", 0)
        title = node.get("title", "")
        disc_url = node.get("url", "")

        text = _build_discussion_text(node)
        if not text:
            logger.debug("Skipping discussion #%s — no body content", number)
            continue

        chunks = _chunk_text(text)
        for i, chunk_text in enumerate(chunks):
            point_id = str(uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"{source.id}:{number}:{i}",
            ))
            all_chunks.append({
                "point_id": point_id,
                "text": f"# Discussion #{number}: {title}\n\n{chunk_text}",
                "source_id": str(source.id),
                "workspace_id": str(source.workspace_id),
                "source_type": "github_discussions",
                "source_name": source.name,
                "chunk_index": i,
                "page_url": disc_url,
                "discussion_number": number,
            })

    if not all_chunks:
        raise ValueError("No text content could be extracted from the discussions.")

    qdrant = get_qdrant()

    # Delete old chunks for this source before upserting (idempotent re-ingestion)
    try:
        qdrant.delete(
            collection_name="contextiq_chunks",
            points_selector=Filter(must=[
                FieldCondition(key="source_id", match=MatchValue(value=str(source.id)))
            ]),
        )
    except Exception as e:
        logger.warning("Could not delete old chunks for source %s: %s", source.id, e)

    loop = asyncio.get_event_loop()
    texts = [c["text"] for c in all_chunks]
    embeddings = await loop.run_in_executor(None, get_embeddings, texts)

    points = [
        PointStruct(
            id=chunk.pop("point_id"),
            vector=emb,
            payload=chunk,
        )
        for chunk, emb in zip(all_chunks, embeddings)
    ]
    await loop.run_in_executor(None, lambda: qdrant.upsert(collection_name="contextiq_chunks", points=points))
    logger.info("Ingested %d chunks from %d discussions for source %s", len(points), len(all_nodes), source.id)
    return len(points)
