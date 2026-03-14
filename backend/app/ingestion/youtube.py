"""
YouTube video ingestion via transcript only.

Uses youtube-transcript-api to fetch captions/transcript. If no transcript is
available (e.g. disabled by uploader, or no captions), ingestion fails with a
clear error.
"""

import logging
import re
import uuid

from qdrant_client.models import PointStruct

from app.core.qdrant_client import get_qdrant
from app.ingestion.embedder import get_embeddings
from app.models.db import Source

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200


def _extract_video_id(url: str) -> str | None:
    """Extract YouTube video ID from URL (watch?v=ID or youtu.be/ID)."""
    if "youtube.com/watch" in url:
        match = re.search(r"[?&]v=([a-zA-Z0-9_-]{11})", url)
        return match.group(1) if match else None
    if "youtu.be/" in url:
        match = re.search(r"youtu\.be/([a-zA-Z0-9_-]{11})", url)
        return match.group(1) if match else None
    return None


def _chunk_text(text: str) -> list[str]:
    """Split transcript into overlapping chunks."""
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


async def ingest_youtube(source: Source) -> int:
    if not source.url:
        raise ValueError("YouTube source requires a URL")

    video_id = _extract_video_id(source.url)
    if not video_id:
        raise ValueError("Could not extract video ID from URL. Use format https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID")

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        raise RuntimeError("youtube-transcript-api is not installed. Add it to requirements.txt.")

    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
    except Exception as e:
        err_msg = str(e).lower()
        if "transcript" in err_msg or "disabled" in err_msg or "not available" in err_msg or "could not retrieve" in err_msg:
            raise ValueError(
                "This video has no transcript or captions available. "
                "Only videos with captions (including auto-generated) can be indexed."
            ) from e
        raise ValueError(f"Failed to fetch transcript: {e}") from e

    if not transcript_list:
        raise ValueError("No transcript segments returned for this video.")

    full_text = " ".join(entry["text"] for entry in transcript_list)
    if not full_text.strip():
        raise ValueError("Transcript is empty.")

    chunks = _chunk_text(full_text)
    if not chunks:
        raise ValueError("No text chunks could be created from the transcript.")

    qdrant = get_qdrant()
    payloads = []
    for i, chunk_text in enumerate(chunks):
        payloads.append({
            "text": f"# YouTube: {source.name}\n\n{chunk_text}",
            "source_id": str(source.id),
            "workspace_id": str(source.workspace_id),
            "source_type": "youtube",
            "source_name": source.name,
            "chunk_index": i,
            "video_id": video_id,
        })

    texts = [p["text"] for p in payloads]
    embeddings = get_embeddings(texts)

    points = [
        PointStruct(id=str(uuid.uuid4()), vector=emb, payload=chunk)
        for chunk, emb in zip(payloads, embeddings)
    ]
    qdrant.upsert(collection_name="contextiq_chunks", points=points)
    logger.info("Ingested %d chunks from YouTube video %s for source %s", len(points), video_id, source.id)
    return len(points)
