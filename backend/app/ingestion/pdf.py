import io
import logging
import uuid

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
MAX_PAGES = 2500
MAX_CHUNKS = 5000
EMBED_BATCH_SIZE = 100
UPSERT_BATCH_SIZE = 100


def _extract_text_pymupdf(pdf_bytes: bytes, max_pages: int) -> tuple[str, int, int]:
    """Extract text using PyMuPDF (fitz). Returns (full_text, total_pages, pages_with_text)."""
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = min(len(doc), max_pages)
    pages_with_text = 0
    parts = []
    for page_num in range(total_pages):
        page = doc[page_num]
        text = (page.get_text("text", sort=True) or "").strip()
        if text:
            pages_with_text += 1
            parts.append(text)
    doc.close()
    full_text = "\n\n".join(parts)
    return full_text, total_pages, pages_with_text


def _extract_text_pdfplumber(pdf_bytes: bytes, max_pages: int) -> tuple[str, int, int]:
    """Extract text using pdfplumber. Returns (full_text, total_pages, pages_with_text)."""
    import pdfplumber
    full_text = ""
    pages_with_text = 0
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        total_pages = min(len(pdf.pages), max_pages)
        for i in range(total_pages):
            page = pdf.pages[i]
            page_text = page.extract_text()
            if page_text and page_text.strip():
                pages_with_text += 1
                full_text += page_text.strip() + "\n\n"
    return full_text.strip(), total_pages, pages_with_text


def _extract_pdf_text(pdf_bytes: bytes, filename: str, max_pages: int) -> tuple[str, int, int]:
    """
    Extract text from PDF. Tries PyMuPDF first (better for full-book extraction),
    then pdfplumber. Returns (full_text, total_pages, pages_with_text).
    """
    total_pages, pages_with_text = 0, 0
    full_text = ""

    try:
        full_text, total_pages, pages_with_text = _extract_text_pymupdf(pdf_bytes, max_pages)
        logger.info(
            "PDF %s: PyMuPDF extracted %d pages with text (total %d)",
            filename, pages_with_text, total_pages,
        )
    except Exception as e:
        logger.warning("PDF %s: PyMuPDF failed (%s), trying pdfplumber", filename, e)

    if not full_text or (total_pages > 0 and pages_with_text < total_pages // 4):
        try:
            fallback_text, fallback_total, fallback_with = _extract_text_pdfplumber(
                pdf_bytes, max_pages
            )
            if fallback_with > pages_with_text or not full_text:
                full_text = fallback_text
                total_pages = fallback_total
                pages_with_text = fallback_with
                logger.info(
                    "PDF %s: pdfplumber fallback: %d pages with text (total %d)",
                    filename, pages_with_text, total_pages,
                )
        except Exception as e:
            logger.warning("PDF %s: pdfplumber fallback failed: %s", filename, e)

    return full_text, total_pages, pages_with_text


def _chunk_text(text: str) -> list[str]:
    """Split text into overlapping chunks at paragraph boundaries."""
    paragraphs = text.split("\n\n")
    chunks = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current_chunk) + len(para) > CHUNK_SIZE and current_chunk:
            chunks.append(current_chunk.strip())
            overlap_text = current_chunk[-CHUNK_OVERLAP:] if len(current_chunk) > CHUNK_OVERLAP else current_chunk
            current_chunk = overlap_text + "\n\n" + para
        else:
            current_chunk = current_chunk + "\n\n" + para if current_chunk else para

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


async def ingest_pdf(source: Source) -> int:
    s3 = get_s3()
    qdrant = get_qdrant()

    prefix = f"workspaces/{source.workspace_id}/pdfs/{source.id}/"
    response = s3.list_objects_v2(Bucket=settings.MINIO_BUCKET, Prefix=prefix)

    all_chunks: list[dict] = []

    for obj in response.get("Contents", []):
        file_obj = s3.get_object(Bucket=settings.MINIO_BUCKET, Key=obj["Key"])
        pdf_bytes = file_obj["Body"].read()
        filename = obj["Key"].split("/")[-1]

        full_text, total_pages, pages_with_text = _extract_pdf_text(
            pdf_bytes, filename, MAX_PAGES
        )
        if not full_text.strip():
            logger.warning("PDF %s: no text extracted (%d pages)", filename, total_pages)
            continue

        chunks = _chunk_text(full_text)
        logger.info(
            "PDF %s: %d pages with text -> %d chunks",
            filename, pages_with_text, len(chunks),
        )
        for i, chunk_text in enumerate(chunks):
            if len(all_chunks) >= MAX_CHUNKS:
                logger.warning("PDF %s: hit max chunks %d", filename, MAX_CHUNKS)
                break
            all_chunks.append({
                "text": f"# PDF: {source.name}\n\n{chunk_text}",
                "source_id": str(source.id),
                "workspace_id": str(source.workspace_id),
                "source_type": "pdf",
                "source_name": source.name,
                "chunk_index": i,
                "file_path": filename,
            })
        if len(all_chunks) >= MAX_CHUNKS:
            break

    if not all_chunks:
        return 0

    total_points = 0
    for i in range(0, len(all_chunks), EMBED_BATCH_SIZE):
        batch = all_chunks[i : i + EMBED_BATCH_SIZE]
        texts = [c["text"] for c in batch]
        embeddings = get_embeddings(texts)
        points = [
            PointStruct(
                id=str(uuid.uuid4()),
                vector=embedding,
                payload=chunk,
            )
            for chunk, embedding in zip(batch, embeddings)
        ]
        for j in range(0, len(points), UPSERT_BATCH_SIZE):
            qdrant.upsert(
                collection_name="contextiq_chunks",
                points=points[j : j + UPSERT_BATCH_SIZE],
            )
        total_points += len(points)
        if (i + EMBED_BATCH_SIZE) < len(all_chunks):
            logger.info("PDF ingestion progress: %d / %d chunks", total_points, len(all_chunks))

    return total_points
