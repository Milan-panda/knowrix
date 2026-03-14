"""
Web page crawler and ingestion.

Crawls a URL (and optionally same-domain links up to a configurable depth),
extracts text content, chunks it, embeds, and stores in Qdrant.

Respects robots.txt, rate-limits to ~1 req/s, restricts to same-domain links.
"""

import asyncio
import logging
import re
import uuid
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup
from qdrant_client.models import PointStruct

from app.core.config import get_settings
from app.core.minio_client import get_s3
from app.core.qdrant_client import get_qdrant
from app.ingestion.embedder import get_embeddings
from app.models.db import Source

logger = logging.getLogger(__name__)
settings = get_settings()

USER_AGENT = "ContextIQ/1.0 (+https://contextiq.dev)"
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
MAX_PAGES = 50
MAX_PAGE_SIZE = 2 * 1024 * 1024  # 2MB
RATE_LIMIT_SECONDS = 1.0
EMBED_BATCH_SIZE = 32


def _html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "svg", "form"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def _extract_title(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    title_tag = soup.find("title")
    if title_tag and title_tag.string:
        return title_tag.string.strip()[:200]
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)[:200]
    return ""


def _extract_same_domain_links(html: str, base_url: str, domain: str) -> list[str]:
    """Extract absolute URLs that belong to the same domain."""
    soup = BeautifulSoup(html, "html.parser")
    links = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith(("#", "mailto:", "javascript:", "tel:")):
            continue
        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        # Same domain only, HTTP(S) only, strip fragments
        if parsed.hostname == domain and parsed.scheme in ("http", "https"):
            clean = parsed._replace(fragment="").geturl()
            links.add(clean)
    return list(links)


def _chunk_text(text: str, page_url: str) -> list[str]:
    """Split text into overlapping chunks with page URL context."""
    paragraphs = text.split("\n\n")
    chunks = []
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

    # Prepend URL context to each chunk
    return [f"# Source: {page_url}\n\n{chunk}" for chunk in chunks if len(chunk) > 20]


async def _fetch_robots_txt(client: httpx.AsyncClient, base_url: str) -> RobotFileParser:
    """Fetch and parse robots.txt for the domain."""
    parsed = urlparse(base_url)
    robots_url = f"{parsed.scheme}://{parsed.hostname}/robots.txt"
    rp = RobotFileParser()
    try:
        resp = await client.get(robots_url, timeout=10.0)
        if resp.status_code == 200:
            rp.parse(resp.text.splitlines())
        else:
            rp.allow_all = True
    except Exception:
        rp.allow_all = True
    return rp


async def _crawl_pages(
    start_url: str,
    max_depth: int = 1,
) -> list[dict]:
    """
    Crawl pages starting from start_url up to max_depth.
    Returns list of {"url": str, "html": str, "title": str}.
    """
    parsed_start = urlparse(start_url)
    domain = parsed_start.hostname

    pages: list[dict] = []
    visited: set[str] = set()
    queue: list[tuple[str, int]] = [(start_url, 0)]

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=30.0,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        robots = await _fetch_robots_txt(client, start_url)

        while queue and len(pages) < MAX_PAGES:
            url, depth = queue.pop(0)

            if url in visited:
                continue
            visited.add(url)

            if not robots.can_fetch(USER_AGENT, url):
                logger.info("Blocked by robots.txt: %s", url)
                continue

            try:
                resp = await client.get(url)
                resp.raise_for_status()
            except Exception as e:
                logger.warning("Failed to fetch %s: %s", url, e)
                continue

            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type:
                continue

            if len(resp.content) > MAX_PAGE_SIZE:
                logger.warning("Page too large, skipping: %s (%d bytes)", url, len(resp.content))
                continue

            html = resp.text
            title = _extract_title(html)
            pages.append({"url": url, "html": html, "title": title})
            logger.info("Crawled [%d/%d] %s", len(pages), MAX_PAGES, url)

            if depth < max_depth:
                links = _extract_same_domain_links(html, url, domain)
                for link in links:
                    if link not in visited:
                        queue.append((link, depth + 1))

            await asyncio.sleep(RATE_LIMIT_SECONDS)

    return pages


async def ingest_web(source: Source, max_depth: int = 1) -> int:
    if not source.url:
        raise ValueError("Web source requires a URL")

    qdrant = get_qdrant()
    s3 = get_s3()

    pages = await _crawl_pages(source.url, max_depth=max_depth)

    if not pages:
        raise ValueError(f"Could not fetch any pages from {source.url}")

    logger.info("Crawled %d pages from %s", len(pages), source.url)

    all_chunks: list[dict] = []

    for page in pages:
        # Archive raw HTML
        page_hash = uuid.uuid5(uuid.NAMESPACE_URL, page["url"]).hex[:12]
        key = f"workspaces/{source.workspace_id}/web/{source.id}/{page_hash}.html"
        try:
            s3.put_object(
                Bucket=settings.MINIO_BUCKET,
                Key=key,
                Body=page["html"].encode("utf-8"),
                ContentType="text/html",
            )
        except Exception as e:
            logger.warning("Failed to archive HTML to MinIO: %s", e)

        text = _html_to_text(page["html"])
        if len(text.strip()) < 50:
            continue

        chunks = _chunk_text(text, page["url"])
        for i, chunk_text in enumerate(chunks):
            all_chunks.append({
                "text": chunk_text,
                "source_id": str(source.id),
                "workspace_id": str(source.workspace_id),
                "source_type": "web",
                "source_name": source.name,
                "page_url": page["url"],
                "page_title": page.get("title", ""),
                "chunk_index": i,
            })

    if not all_chunks:
        raise ValueError("No text content could be extracted from the crawled pages")

    # Embed in batches
    texts = [c["text"] for c in all_chunks]
    all_embeddings = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        all_embeddings.extend(get_embeddings(batch))

    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=emb,
            payload=chunk,
        )
        for chunk, emb in zip(all_chunks, all_embeddings)
    ]

    batch_size = 100
    for i in range(0, len(points), batch_size):
        qdrant.upsert(collection_name="contextiq_chunks", points=points[i : i + batch_size])

    logger.info("Ingested %d chunks from %d pages for source %s", len(points), len(pages), source.id)
    return len(points)
