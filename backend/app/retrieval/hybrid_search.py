"""
Retrieval pipeline: dense vector search → dedup → cross-encoder rerank.

The scroll-based keyword search and RRF fusion have been removed in favor
of a simpler, faster pipeline that scales to 100k+ chunks.
"""

import asyncio
import logging
import re

from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny

from app.core.qdrant_client import get_qdrant
from app.ingestion.embedder import get_embeddings
from app.retrieval.reranker import rerank

logger = logging.getLogger(__name__)

DENSE_CANDIDATE_LIMIT = 50
DEDUP_LINE_BAND_SIZE = 40
# For long docs (e.g. PDF books), spread results: max chunks per (source, file, region)
CHUNK_BUCKET_SIZE = 80
MAX_CHUNKS_PER_BUCKET = 3

STOP_WORDS = {
    "a", "an", "the", "is", "it", "in", "on", "at", "to", "for", "of",
    "and", "or", "not", "this", "that", "with", "from", "by", "as", "be",
    "was", "are", "were", "been", "has", "have", "had", "do", "does", "did",
    "can", "could", "will", "would", "shall", "should", "may", "might",
    "me", "my", "we", "our", "you", "your", "he", "she", "they", "them",
    "what", "which", "who", "how", "when", "where", "why",
    "show", "get", "give", "tell", "find", "return", "write", "explain",
    "code", "file", "function", "class", "method", "module", "all",
    "about", "just", "also", "very", "some", "any", "each", "every",
    "there", "here", "if", "else", "then", "than", "so", "but", "no", "yes",
}

BROAD_QUERY_EXPANSIONS = [
    "summary overview main topics covered",
    "introduction getting started purpose",
]


def _build_filter(workspace_id: str, source_ids: list[str] | None = None) -> Filter:
    conditions = [
        FieldCondition(key="workspace_id", match=MatchValue(value=workspace_id))
    ]
    if source_ids:
        conditions.append(
            FieldCondition(key="source_id", match=MatchAny(any=source_ids))
        )
    return Filter(must=conditions)


def _tokenize(text: str) -> set[str]:
    tokens = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', text.lower())
    return {t for t in tokens if len(t) > 1 and t not in STOP_WORDS}


def _extract_file_refs(query: str) -> list[str]:
    refs: list[str] = []
    file_patterns = re.findall(r'[\w./\\-]+\.\w{1,5}', query)
    refs.extend(p.lower() for p in file_patterns)
    snake = re.findall(r'\b[a-z][a-z0-9]*_[a-z0-9_]+\b', query)
    refs.extend(snake)
    return refs


def _is_broad_query(query: str) -> bool:
    tokens = _tokenize(query)
    file_refs = _extract_file_refs(query)
    return len(tokens) == 0 and len(file_refs) == 0 and len(query) < 60


def _dense_search(
    qdrant,
    embedding: list[float],
    search_filter: Filter,
    limit: int,
) -> list:
    try:
        resp = qdrant.query_points(
            collection_name="contextiq_chunks",
            query=embedding,
            query_filter=search_filter,
            limit=limit,
            with_payload=True,
        )
        return resp.points
    except Exception as e:
        logger.error("Dense search failed: %s", e)
        return []


def _dedup(candidates: list[dict]) -> list[dict]:
    """Remove near-duplicate chunks (same file+line range or same chunk_index)."""
    seen: set[str] = set()
    results = []
    for c in candidates:
        source_id = c.get("source_id", "")
        file_path = c.get("file_path", "") or ""
        if file_path:
            line_start = c.get("line_start") or 0
            key = f"{source_id}:{file_path}:{line_start // DEDUP_LINE_BAND_SIZE}"
        else:
            key = f"{source_id}:{c.get('chunk_index', id(c))}"
        if key not in seen:
            seen.add(key)
            results.append(c)
    return results


def _apply_diversity(chunks: list[dict], top_k: int) -> list[dict]:
    """
    Pick top_k chunks while spreading across long documents (e.g. books).
    For the same source+file, limit how many chunks we take from each "region"
    (chunk_index // CHUNK_BUCKET_SIZE) so we don't return only the preface.
    """
    if len(chunks) <= top_k:
        return chunks
    bucket_counts: dict[str, int] = {}
    result = []
    for c in chunks:
        if len(result) >= top_k:
            break
        source_id = c.get("source_id", "") or ""
        file_path = c.get("file_path", "") or ""
        chunk_index = c.get("chunk_index")
        if chunk_index is not None and source_id and file_path:
            bucket = chunk_index // CHUNK_BUCKET_SIZE
            key = f"{source_id}:{file_path}:{bucket}"
            if bucket_counts.get(key, 0) >= MAX_CHUNKS_PER_BUCKET:
                continue
            bucket_counts[key] = bucket_counts.get(key, 0) + 1
        result.append(c)
    # If we didn't fill top_k (e.g. few buckets), append remaining in order
    for c in chunks:
        if len(result) >= top_k:
            break
        if c not in result:
            result.append(c)
    return result[:top_k]


def _payload_to_chunk(payload: dict) -> dict:
    return {
        "text": payload.get("text", ""),
        "source_type": payload.get("source_type", ""),
        "source_name": payload.get("source_name", ""),
        "source_id": payload.get("source_id", ""),
        "file_path": payload.get("file_path"),
        "line_start": payload.get("line_start"),
        "line_end": payload.get("line_end"),
        "symbol_name": payload.get("symbol_name"),
        "symbol_type": payload.get("symbol_type"),
        "page_url": payload.get("page_url"),
        "page_title": payload.get("page_title"),
        "chunk_index": payload.get("chunk_index"),
    }


async def hybrid_search(
    workspace_id: str,
    query: str,
    top_k: int = 18,
    source_ids: list[str] | None = None,
) -> list[dict]:
    qdrant = get_qdrant()
    search_filter = _build_filter(workspace_id, source_ids)
    broad = _is_broad_query(query)

    logger.info("Search query=%r broad=%s top_k=%d", query[:80], broad, top_k)

    # For broad queries, run multiple dense searches with expanded queries to pull
    # from different parts of the indexed content.
    queries_to_embed = [query]
    if broad:
        queries_to_embed.extend(BROAD_QUERY_EXPANSIONS)

    loop = asyncio.get_event_loop()
    all_embeddings = await loop.run_in_executor(None, get_embeddings, queries_to_embed)

    # Collect candidates from all query variants
    seen_ids: set[str] = set()
    all_candidates: list[dict] = []
    per_query_limit = DENSE_CANDIDATE_LIMIT if not broad else DENSE_CANDIDATE_LIMIT // len(queries_to_embed) + 10

    for emb in all_embeddings:
        points = _dense_search(qdrant, emb, search_filter, per_query_limit)
        for p in points:
            pid = str(p.id)
            if pid not in seen_ids:
                seen_ids.add(pid)
                all_candidates.append(_payload_to_chunk(p.payload))

    logger.info("Dense search returned %d unique candidates", len(all_candidates))

    if not all_candidates:
        return []

    deduped = _dedup(all_candidates)
    logger.info("After dedup: %d candidates", len(deduped))

    rerank_limit = min(len(deduped), max(top_k * 3, 50))
    reranked = await rerank(query, deduped, top_k=rerank_limit)
    results = _apply_diversity(reranked, top_k)
    logger.info("After rerank + diversity: %d results", len(results))
    return results
