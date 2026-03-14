"""
Thin re-export from the embedding service.

All ingestion modules import from here so there's a single import path.
Swap the underlying model by changing EmbeddingService config.
"""

from app.services.embedding_service import get_embeddings, get_embedding  # noqa: F401
