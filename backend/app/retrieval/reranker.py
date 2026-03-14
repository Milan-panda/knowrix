"""
Cross-encoder reranker for improving retrieval relevance.

Scores each (query, chunk_text) pair with a cross-encoder model and
returns the top_k chunks sorted by relevance. The model is lazy-loaded
on first call to avoid startup cost.
"""

import logging

from sentence_transformers import CrossEncoder

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_model: CrossEncoder | None = None


def _get_model() -> CrossEncoder:
    global _model
    if _model is None:
        settings = get_settings()
        logger.info("Loading reranker model: %s", settings.RERANKER_MODEL)
        _model = CrossEncoder(settings.RERANKER_MODEL, max_length=512)
        logger.info("Reranker model loaded")
    return _model


async def rerank(query: str, chunks: list[dict], top_k: int = 18) -> list[dict]:
    """
    Score each chunk against the query using a cross-encoder and return
    the top_k most relevant chunks sorted by descending relevance score.
    """
    if not chunks:
        return []

    if len(chunks) <= top_k:
        return chunks

    model = _get_model()
    pairs = [[query, c.get("text", "")] for c in chunks]
    scores = model.predict(pairs, show_progress_bar=False)

    scored = sorted(zip(scores, chunks), key=lambda x: x[0], reverse=True)
    results = [chunk for _, chunk in scored[:top_k]]

    logger.info(
        "Reranked %d candidates -> %d results (top score=%.4f, cutoff=%.4f)",
        len(chunks), len(results),
        scored[0][0] if scored else 0,
        scored[min(top_k, len(scored)) - 1][0] if scored else 0,
    )
    return results
