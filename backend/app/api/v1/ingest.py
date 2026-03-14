import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.workspace_auth import require_workspace_role
from app.models.db import User, Source, IngestionJob, WorkspaceMember
from app.models.schemas import IngestionJobResponse
from app.tasks.ingestion import run_ingestion_task

logger = logging.getLogger(__name__)
router = APIRouter()


async def _verify_source_access(source: Source, user_id: UUID, db: AsyncSession) -> None:
    """Raise 403 if the user is not a member of the source's workspace."""
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == source.workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a workspace member")


async def _schedule_ingestion_for_source(
    source_id: UUID,
    source: Source,
    current_user: User,
    db: AsyncSession,
    **ingest_kwargs,
) -> IngestionJob:
    """Verify access, set source to processing, create job, commit, and enqueue Celery task."""
    await _verify_source_access(source, current_user.id, db)
    await require_workspace_role(source.workspace_id, current_user, db, ["owner", "admin"])
    source.status = "processing"
    job = IngestionJob(source_id=source_id)
    db.add(job)
    await db.commit()
    max_depth = ingest_kwargs.get("max_depth", 1)
    run_ingestion_task.delay(str(job.id), str(source_id), max_depth=max_depth)
    return job


@router.post("/{source_id}", response_model=IngestionJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def trigger_ingestion(
    source_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start or re-run ingestion for a source. Existing chunks for this source are replaced."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")
    return await _schedule_ingestion_for_source(source_id, source, current_user, db)


@router.post("/{source_id}/reindex", response_model=IngestionJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def reindex_source(
    source_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reindex an existing source: clear its chunks and run ingestion again (e.g. after improving chunking)."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")
    return await _schedule_ingestion_for_source(source_id, source, current_user, db)


@router.get("/{source_id}/status", response_model=list[IngestionJobResponse])
async def get_ingestion_status(
    source_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")
    await _verify_source_access(source, current_user.id, db)
    result = await db.execute(
        select(IngestionJob).where(IngestionJob.source_id == source_id)
    )
    return result.scalars().all()
