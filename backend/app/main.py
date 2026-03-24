from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import engine
from app.core.minio_client import ensure_bucket
from app.core.qdrant_client import get_qdrant
from app.models.db import Base
from app.api.v1.router import api_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Add columns that create_all won't add to existing tables
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)"
        ))
        await conn.execute(text(
            "ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS selected_source_ids JSONB"
        ))

    ensure_bucket()

    qdrant = get_qdrant()
    collections = [c.name for c in qdrant.get_collections().collections]
    if "contextiq_chunks" not in collections:
        from qdrant_client.models import Distance, VectorParams
        qdrant.create_collection(
            collection_name="contextiq_chunks",
            vectors_config=VectorParams(size=settings.EMBEDDING_DIM, distance=Distance.COSINE),
        )
    else:
        info = qdrant.get_collection("contextiq_chunks")
        current_dim = info.config.params.vectors.size
        if current_dim != settings.EMBEDDING_DIM:
            import logging
            log = logging.getLogger(__name__)
            log.warning(
                "Qdrant collection dim (%d) != configured dim (%d). Recreating collection.",
                current_dim, settings.EMBEDDING_DIM,
            )
            qdrant.delete_collection("contextiq_chunks")
            from qdrant_client.models import Distance, VectorParams
            qdrant.create_collection(
                collection_name="contextiq_chunks",
                vectors_config=VectorParams(size=settings.EMBEDDING_DIM, distance=Distance.COSINE),
            )

    # Payload indexes for fast filtered vector search at scale
    from qdrant_client.models import PayloadSchemaType
    for field in ("workspace_id", "source_id"):
        try:
            qdrant.create_payload_index(
                collection_name="contextiq_chunks",
                field_name=field,
                field_schema=PayloadSchemaType.KEYWORD,
            )
        except Exception:
            pass  # index already exists

    yield

    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="ContextIQ API",
    description="Developer-focused knowledge base chat API",
    version="0.1.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "environment": settings.ENVIRONMENT}
