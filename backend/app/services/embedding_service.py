"""
Local embedding service using sentence-transformers.

Swapping models is a config change (EMBEDDING_MODEL + EMBEDDING_DIM).
The service lazy-loads the model on first call to avoid startup cost
if embeddings aren't needed in that process.
"""

import logging
from functools import lru_cache

from sentence_transformers import SentenceTransformer

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        settings = get_settings()
        logger.info("Loading embedding model: %s", settings.EMBEDDING_MODEL)
        _model = SentenceTransformer(settings.EMBEDDING_MODEL)
        logger.info("Embedding model loaded (dim=%d)", settings.EMBEDDING_DIM)
    return _model


def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts. Returns list of float vectors."""
    if not texts:
        return []
    model = _get_model()
    embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    return embeddings.tolist()


def get_embedding(text: str) -> list[float]:
    """Embed a single text."""
    return get_embeddings([text])[0]


@lru_cache(maxsize=1)
def embedding_dim() -> int:
    return get_settings().EMBEDDING_DIM
