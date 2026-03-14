"""
Celery task for source ingestion. Runs in a separate worker process so the API stays responsive.
Uses a per-task async engine so each asyncio.run() has its own event loop and connections;
the global engine is tied to one loop and causes "attached to a different loop" on the next task.
"""

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

from qdrant_client.models import Filter, FieldCondition, MatchValue
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.config import get_settings
from app.core.connector_encryption import decrypt_connector_token
from app.core.qdrant_client import get_qdrant
from app.models.db import Source, IngestionJob, WorkspaceConnector

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _mark_job_and_source_failed(
    job_id: str, source_id: str, error: Exception
) -> None:
    """Use a fresh connection to set job/source to failed so UI never sticks on 'processing'."""
    settings = get_settings()
    engine = create_async_engine(settings.postgres_dsn, pool_pre_ping=True)
    try:
        session_factory = async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        async with session_factory() as db:
            r = await db.execute(select(IngestionJob).where(IngestionJob.id == UUID(job_id)))
            job = r.scalar_one_or_none()
            r = await db.execute(select(Source).where(Source.id == UUID(source_id)))
            source = r.scalar_one_or_none()
            if job:
                job.status = "failed"
                job.error = str(error)[:4096]
                job.completed_at = datetime.now(timezone.utc)
            if source:
                source.status = "error"
            await db.commit()
    finally:
        await engine.dispose()


async def _run_ingestion_async(job_id: str, source_id: str, max_depth: int = 1) -> None:
    """Async ingestion logic (same as ingest._run_ingestion)."""
    job_uuid = UUID(job_id)
    source_uuid = UUID(source_id)

    settings = get_settings()
    engine = create_async_engine(
        settings.postgres_dsn,
        pool_pre_ping=True,
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    try:
        async with session_factory() as db:
            result = await db.execute(select(IngestionJob).where(IngestionJob.id == job_uuid))
            job = result.scalar_one()
            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            await db.commit()

            result = await db.execute(select(Source).where(Source.id == source_uuid))
            source = result.scalar_one()

            async def _connector_token(provider: str) -> str | None:
                r = await db.execute(
                    select(WorkspaceConnector).where(
                        WorkspaceConnector.workspace_id == source.workspace_id,
                        WorkspaceConnector.provider == provider,
                    )
                )
                conn = r.scalar_one_or_none()
                if not conn or not conn.access_token:
                    return None
                return decrypt_connector_token(conn.access_token)

            try:
                qdrant = get_qdrant()
                qdrant.delete(
                    collection_name="contextiq_chunks",
                    points_selector=Filter(
                        must=[FieldCondition(key="source_id", match=MatchValue(value=source_id))]
                    ),
                )

                chunks_count = 0

                if source.type == "pdf":
                    from app.ingestion.pdf import ingest_pdf
                    chunks_count = await ingest_pdf(source)
                elif source.type == "file":
                    from app.core.minio_client import get_s3 as _get_s3
                    from app.core.config import get_settings as _gs
                    _s3 = _get_s3()
                    _settings = _gs()
                    prefix = f"workspaces/{source.workspace_id}/files/{source.id}/"
                    objs = _s3.list_objects_v2(Bucket=_settings.MINIO_BUCKET, Prefix=prefix)
                    first_key = (objs.get("Contents") or [{}])[0].get("Key", "")
                    ext = ("." + first_key.rsplit(".", 1)[-1]).lower() if "." in first_key else ""
                    if ext == ".docx":
                        from app.ingestion.docx import ingest_docx
                        chunks_count = await ingest_docx(source)
                    else:
                        from app.ingestion.textfile import ingest_textfile
                        chunks_count = await ingest_textfile(source)
                elif source.type == "github":
                    from app.ingestion.github import ingest_github
                    github_token = await _connector_token("github")
                    chunks_count = await ingest_github(source, access_token=github_token)
                elif source.type == "web":
                    from app.ingestion.web import ingest_web
                    chunks_count = await ingest_web(source, max_depth=max_depth)
                elif source.type == "notion":
                    from app.ingestion.notion import ingest_notion
                    notion_token = await _connector_token("notion")
                    chunks_count = await ingest_notion(source, access_token=notion_token)
                elif source.type == "github_discussions":
                    from app.ingestion.github_discussions import ingest_github_discussions
                    github_token = await _connector_token("github")
                    chunks_count = await ingest_github_discussions(source, access_token=github_token)
                elif source.type == "youtube":
                    from app.ingestion.youtube import ingest_youtube
                    chunks_count = await ingest_youtube(source)

                job.status = "completed"
                job.chunks_count = chunks_count
                job.completed_at = datetime.now(timezone.utc)
                source.status = "ready"

            except Exception as e:
                logger.exception("Ingestion failed for source %s: %s", source_id, e)
                job.status = "failed"
                job.error = str(e)
                job.completed_at = datetime.now(timezone.utc)
                source.status = "error"
                await db.commit()
                raise

            await db.commit()
    except Exception as e:
        logger.exception("Ingestion task failed for source %s: %s", source_id, e)
        await _mark_job_and_source_failed(job_id, source_id, e)
        raise
    finally:
        await engine.dispose()


@celery_app.task(bind=True, name="app.tasks.ingestion.run_ingestion")
def run_ingestion_task(self, job_id: str, source_id: str, max_depth: int = 1) -> None:
    """Celery task: run ingestion for the given job/source. Runs async logic via asyncio.run."""
    asyncio.run(_run_ingestion_async(job_id, source_id, max_depth=max_depth))
