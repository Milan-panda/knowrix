from qdrant_client import QdrantClient
from app.core.config import get_settings

settings = get_settings()

qdrant = QdrantClient(
    host=settings.QDRANT_HOST,
    port=settings.QDRANT_PORT,
)


def get_qdrant() -> QdrantClient:
    return qdrant
