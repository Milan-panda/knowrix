"""
Ingestion for plain text files (.txt, .md).

Reads the file content, chunks it, embeds, and stores in Qdrant.
"""

import uuid
import logging

from qdrant_client.models import PointStruct

from app.core.config import get_settings
from app.core.minio_client import get_s3
from app.core.qdrant_client import get_qdrant
from app.ingestion.embedder import get_embeddings
from app.models.db import Source

logger = logging.getLogger(__name__)
settings = get_settings()

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200


def _chunk_text(text: str) -> list[str]:
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


async def ingest_textfile(source: Source) -> int:
    s3 = get_s3()
    qdrant = get_qdrant()

    prefix = f"workspaces/{source.workspace_id}/files/{source.id}/"
    response = s3.list_objects_v2(Bucket=settings.MINIO_BUCKET, Prefix=prefix)

    all_chunks: list[dict] = []

    for obj in response.get("Contents", []):
        file_obj = s3.get_object(Bucket=settings.MINIO_BUCKET, Key=obj["Key"])
        raw = file_obj["Body"].read()
        filename = obj["Key"].split("/")[-1]

        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1")

        if not text.strip():
            continue

        chunks = _chunk_text(text)
        for i, chunk_text in enumerate(chunks):
            all_chunks.append({
                "text": chunk_text,
                "source_id": str(source.id),
                "workspace_id": str(source.workspace_id),
                "source_type": "file",
                "source_name": source.name,
                "chunk_index": i,
                "file_path": filename,
            })

    if not all_chunks:
        return 0

    texts = [c["text"] for c in all_chunks]
    embeddings = get_embeddings(texts)

    points = [
        PointStruct(id=str(uuid.uuid4()), vector=emb, payload=chunk)
        for chunk, emb in zip(all_chunks, embeddings)
    ]
    qdrant.upsert(collection_name="contextiq_chunks", points=points)
    logger.info("Ingested %d chunks from text file for source %s", len(points), source.id)
    return len(points)
