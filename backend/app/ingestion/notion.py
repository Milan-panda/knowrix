"""
Notion page ingestion.

Fetches block content from a Notion page and all its sub-pages recursively via the
Notion API. When the user provides a top-level page, we index that page and every
child page inside it. Requires workspace Notion connector or NOTION_API_KEY.
"""

import logging
import re
import uuid
import httpx
from qdrant_client.models import PointStruct

from app.core.config import get_settings
from app.core.qdrant_client import get_qdrant
from app.ingestion.embedder import get_embeddings
from app.models.db import Source

logger = logging.getLogger(__name__)
settings = get_settings()

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200
NOTION_API_BASE = "https://api.notion.com/v1"
MAX_PAGES = 100
MAX_DEPTH = 15


def _extract_page_id(url: str) -> str | None:
    """Extract Notion page ID from URL (ID is 32-char hex, often at end of last path segment)."""
    path = url.split("?")[0].rstrip("/")
    segments = [s for s in path.split("/") if s]
    if not segments:
        return None
    last = segments[-1].replace("-", "")
    if len(last) >= 32 and re.match(r"[a-f0-9]{32}$", last[-32:].lower()):
        raw = last[-32:]
        return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"
    if len(last) == 32 and re.match(r"^[a-f0-9]+$", last.lower()):
        return f"{last[:8]}-{last[8:12]}-{last[12:16]}-{last[16:20]}-{last[20:]}"
    return None


def _page_title_from_properties(properties: dict) -> str:
    """Extract title from a Notion page's properties (find type title, then plain_text)."""
    if not properties:
        return ""
    for prop_value in (properties or {}).values():
        if isinstance(prop_value, dict) and prop_value.get("type") == "title":
            title_arr = prop_value.get("title", [])
            if isinstance(title_arr, list):
                return "".join(
                    item.get("plain_text", "") or ""
                    for item in title_arr
                ).strip()
    return ""


def _block_to_text(block: dict) -> str:
    """Extract plain text from a Notion block (rich_text or caption)."""
    block_type = block.get("type")
    content = block.get(block_type, {})
    if not content:
        return ""

    for key in ("rich_text", "caption"):
        rich = content.get(key, [])
        if not rich:
            continue
        text = "".join(
            item.get("plain_text", "") or ""
            for item in rich
        ).strip()
        if text:
            return text
    return ""


def _chunk_text(text: str) -> list[str]:
    """Split text into overlapping chunks."""
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
    return [c for c in chunks if len(c) > 20]


async def _fetch_block_children(
    client: httpx.AsyncClient,
    block_id: str,
    headers: dict,
) -> list[dict]:
    """Fetch all blocks that are direct children of block_id (paginated)."""
    blocks: list[dict] = []
    next_cursor = None
    while True:
        params = {"page_size": 100}
        if next_cursor:
            params["start_cursor"] = next_cursor
        resp = await client.get(
            f"{NOTION_API_BASE}/blocks/{block_id}/children",
            headers=headers,
            params=params,
        )
        if resp.status_code in (401, 404):
            resp.raise_for_status()
        if resp.status_code != 200:
            resp.raise_for_status()
        data = resp.json()
        blocks.extend(data.get("results", []))
        next_cursor = data.get("next_cursor")
        if not next_cursor:
            break
    return blocks


async def _fetch_page(client: httpx.AsyncClient, page_id: str, headers: dict) -> dict | None:
    """Fetch a Notion page by id; returns None on 404."""
    resp = await client.get(
        f"{NOTION_API_BASE}/pages/{page_id}",
        headers=headers,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


async def _collect_page_content(
    client: httpx.AsyncClient,
    block_id: str,
    headers: dict,
    path_parts: list[str],
    depth: int,
    pages_seen: set[str],
    sections: list[tuple[str, str]],
) -> None:
    """
    Recursively collect all text from a page (block_id) and its child pages.
    Appends (page_path, markdown_section) to sections. path_parts is the title path for headings.
    """
    if depth > MAX_DEPTH:
        logger.warning("Notion: max depth %s reached at block %s", MAX_DEPTH, block_id)
        return
    if len(pages_seen) >= MAX_PAGES:
        logger.warning("Notion: max pages %s reached", MAX_PAGES)
        return

    blocks = await _fetch_block_children(client, block_id, headers)
    current_section: list[str] = []

    for block in blocks:
        if block.get("in_trash"):
            continue
        block_type = block.get("type")
        block_id_val = block.get("id")

        if block_type == "child_page":
            sub_title = (block.get("child_page") or {}).get("title", "") or "Untitled"
            if block_id_val and block_id_val not in pages_seen:
                pages_seen.add(block_id_val)
                sub_path = path_parts + [sub_title]
                if current_section:
                    sections.append((" / ".join(path_parts), "\n".join(current_section)))
                    current_section = []
                await _collect_page_content(
                    client,
                    block_id_val,
                    headers,
                    sub_path,
                    depth + 1,
                    pages_seen,
                    sections,
                )
            continue

        if block_type == "child_database":
            db_title = (block.get("child_database") or {}).get("title", "") or "Database"
            current_section.append(f"\n### {db_title}\n")
            continue

        text = _block_to_text(block)
        if text:
            current_section.append(text)

        if block.get("has_children") and block_id_val and block_type not in ("child_page", "child_database"):
            child_sections: list[tuple[str, str]] = []
            await _collect_page_content(
                client,
                block_id_val,
                headers,
                path_parts,
                depth + 1,
                pages_seen,
                child_sections,
            )
            for _, child_text in child_sections:
                current_section.append(child_text)

    if current_section:
        sections.append((" / ".join(path_parts), "\n".join(current_section)))


async def ingest_notion(source: Source, access_token: str | None = None) -> int:
    if not source.url:
        raise ValueError("Notion source requires a URL")

    token = access_token or getattr(settings, "NOTION_API_KEY", None) or ""
    if not token.strip():
        raise ValueError(
            "Notion is not connected. Connect Notion in Workspace Integrations, or set NOTION_API_KEY in the backend."
        )

    page_id = _extract_page_id(source.url)
    if not page_id:
        raise ValueError("Could not extract Notion page ID from URL. Use a full Notion page URL.")

    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        page_obj = await _fetch_page(client, page_id, headers)
        if not page_obj:
            raise ValueError("Notion page not found. Ensure the page is shared with your integration.")
        root_title = _page_title_from_properties(page_obj.get("properties") or {}) or "Untitled"

        sections: list[tuple[str, str]] = []
        pages_seen: set[str] = set()
        pages_seen.add(page_id)
        await _collect_page_content(
            client,
            page_id,
            headers,
            [root_title],
            0,
            pages_seen,
            sections,
        )

    if not sections:
        return 0

    full_doc_parts: list[str] = []
    for path_str, body in sections:
        if path_str:
            full_doc_parts.append(f"# {path_str}\n{body}")
        else:
            full_doc_parts.append(body)
    full_text = "\n\n".join(full_doc_parts).strip()
    if not full_text:
        return 0

    chunks = _chunk_text(full_text)
    if not chunks:
        return 0

    qdrant = get_qdrant()
    payloads = []
    for i, chunk_text in enumerate(chunks):
        payloads.append({
            "text": f"# Notion: {source.name}\n\n{chunk_text}",
            "source_id": str(source.id),
            "workspace_id": str(source.workspace_id),
            "source_type": "notion",
            "source_name": source.name,
            "chunk_index": i,
            "page_id": page_id,
        })

    texts = [p["text"] for p in payloads]
    embeddings = get_embeddings(texts)

    points = [
        PointStruct(id=str(uuid.uuid4()), vector=emb, payload=chunk)
        for chunk, emb in zip(payloads, embeddings)
    ]
    qdrant.upsert(collection_name="contextiq_chunks", points=points)
    logger.info(
        "Ingested %d chunks from Notion (root %s, %d sections) for source %s",
        len(points),
        page_id,
        len(sections),
        source.id,
    )
    return len(points)
