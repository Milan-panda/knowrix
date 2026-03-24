import io
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, File, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.client_ip import get_client_ip
from app.core.config import get_settings
from app.core.database import get_db
from app.core.minio_client import get_s3
from app.core.workspace_auth import require_workspace_role, get_workspace_member
from app.models.db import User, Source, IngestionJob, WorkspaceMember
from app.models.schemas import SourceCreate, SourceResponse
from app.tasks.ingestion import run_ingestion_task
from app.services.telegram_notify import notify_activity
from app.services.context_groups import sync_system_context_groups

router = APIRouter()
settings = get_settings()


def _schedule_source_created_notify(
    background_tasks: BackgroundTasks,
    user: User,
    workspace_id: UUID,
    source: Source,
    client_ip: str,
):
    background_tasks.add_task(
        notify_activity,
        "New source",
        [
            f"email: {user.email}",
            f"workspace_id: {workspace_id}",
            f"source_id: {source.id}",
            f"type: {source.type}",
            f"name: {source.name}",
        ],
        client_ip=client_ip,
    )


async def _verify_membership(workspace_id: UUID, current_user: User, db: AsyncSession):
    await get_workspace_member(workspace_id, current_user, db)


ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".md"}


def _file_extension(filename: str) -> str:
    return ("." + filename.rsplit(".", 1)[-1]).lower() if "." in filename else ""


@router.post("/upload", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    workspace_id: UUID,
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])

    filename = file.filename or "upload"
    ext = _file_extension(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    source_type = "pdf" if ext == ".pdf" else "file"

    source = Source(
        workspace_id=workspace_id,
        type=source_type,
        name=filename,
        status="processing",
    )
    db.add(source)
    await db.flush()

    s3 = get_s3()
    # PDF uses legacy path for backward compat; other files use /files/
    if ext == ".pdf":
        key = f"workspaces/{workspace_id}/pdfs/{source.id}/{filename}"
    else:
        key = f"workspaces/{workspace_id}/files/{source.id}/{filename}"
    contents = await file.read()
    s3.upload_fileobj(io.BytesIO(contents), settings.MINIO_BUCKET, key)

    job = IngestionJob(source_id=source.id)
    db.add(job)
    await db.commit()
    await sync_system_context_groups(workspace_id, db)

    _schedule_source_created_notify(
        background_tasks, current_user, workspace_id, source, get_client_ip(request)
    )

    run_ingestion_task.delay(str(job.id), str(source.id))

    return source


@router.post("/github", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
async def add_github_source(
    body: SourceCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(body.workspace_id, current_user, db, ["owner", "admin"])

    source = Source(
        workspace_id=body.workspace_id,
        type="github",
        name=body.name,
        url=body.url,
        status="processing",
    )
    db.add(source)
    await db.flush()

    job = IngestionJob(source_id=source.id)
    db.add(job)
    await db.commit()
    await sync_system_context_groups(body.workspace_id, db)

    _schedule_source_created_notify(
        background_tasks, current_user, body.workspace_id, source, get_client_ip(request)
    )

    run_ingestion_task.delay(str(job.id), str(source.id))

    return source


@router.post("/web", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
async def add_web_source(
    body: SourceCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(body.workspace_id, current_user, db, ["owner", "admin"])

    if not body.url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL is required")

    name = body.name or body.url
    max_depth = max(0, min(body.max_depth, 3))

    source = Source(
        workspace_id=body.workspace_id,
        type="web",
        name=name,
        url=body.url,
        status="processing",
    )
    db.add(source)
    await db.flush()

    job = IngestionJob(source_id=source.id)
    db.add(job)
    await db.commit()
    await sync_system_context_groups(body.workspace_id, db)

    _schedule_source_created_notify(
        background_tasks, current_user, body.workspace_id, source, get_client_ip(request)
    )

    run_ingestion_task.delay(str(job.id), str(source.id), max_depth=max_depth)

    return source


@router.post("/notion", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
async def add_notion_source(
    body: SourceCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(body.workspace_id, current_user, db, ["owner", "admin"])
    if not body.url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Notion page URL is required")

    name = body.name or "Notion page"
    source = Source(
        workspace_id=body.workspace_id,
        type="notion",
        name=name,
        url=body.url,
        status="processing",
    )
    db.add(source)
    await db.flush()
    job = IngestionJob(source_id=source.id)
    db.add(job)
    await db.commit()
    await sync_system_context_groups(body.workspace_id, db)
    _schedule_source_created_notify(
        background_tasks, current_user, body.workspace_id, source, get_client_ip(request)
    )
    run_ingestion_task.delay(str(job.id), str(source.id))
    return source


@router.post("/github_discussions", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
async def add_github_discussions_source(
    body: SourceCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(body.workspace_id, current_user, db, ["owner", "admin"])
    if not body.url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GitHub repository URL is required")

    name = body.name or "GitHub Discussions"
    source = Source(
        workspace_id=body.workspace_id,
        type="github_discussions",
        name=name,
        url=body.url,
        status="processing",
    )
    db.add(source)
    await db.flush()
    job = IngestionJob(source_id=source.id)
    db.add(job)
    await db.commit()
    await sync_system_context_groups(body.workspace_id, db)
    _schedule_source_created_notify(
        background_tasks, current_user, body.workspace_id, source, get_client_ip(request)
    )
    run_ingestion_task.delay(str(job.id), str(source.id))
    return source


@router.post("/youtube", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
async def add_youtube_source(
    body: SourceCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(body.workspace_id, current_user, db, ["owner", "admin"])
    if not body.url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="YouTube video URL is required")

    name = body.name or "YouTube video"
    source = Source(
        workspace_id=body.workspace_id,
        type="youtube",
        name=name,
        url=body.url,
        status="processing",
    )
    db.add(source)
    await db.flush()
    job = IngestionJob(source_id=source.id)
    db.add(job)
    await db.commit()
    await sync_system_context_groups(body.workspace_id, db)
    _schedule_source_created_notify(
        background_tasks, current_user, body.workspace_id, source, get_client_ip(request)
    )
    run_ingestion_task.delay(str(job.id), str(source.id))
    return source


@router.get("", response_model=list[SourceResponse])
async def list_sources(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _verify_membership(workspace_id, current_user, db)

    result = await db.execute(
        select(Source).where(Source.workspace_id == workspace_id)
    )
    sources = list(result.scalars().all())
    if not sources:
        return []

    source_ids = [s.id for s in sources]
    jobs_result = await db.execute(
        select(IngestionJob)
        .where(
            and_(IngestionJob.source_id.in_(source_ids), IngestionJob.status == "failed")
        )
        .order_by(IngestionJob.completed_at.desc().nulls_last())
    )
    error_map: dict[UUID, str] = {}
    for job in jobs_result.scalars().all():
        if job.source_id not in error_map and job.error:
            error_map[job.source_id] = job.error

    return [
        SourceResponse.model_validate(s).model_copy(
            update={"last_job_error": error_map.get(s.id)}
        )
        for s in sources
    ]


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")

    await require_workspace_role(source.workspace_id, current_user, db, ["owner", "admin"])

    # Remove vectors from Qdrant
    from app.core.qdrant_client import get_qdrant
    from qdrant_client.models import Filter, FieldCondition, MatchValue
    try:
        qdrant = get_qdrant()
        qdrant.delete(
            collection_name="contextiq_chunks",
            points_selector=Filter(
                must=[FieldCondition(key="source_id", match=MatchValue(value=str(source_id)))]
            ),
        )
    except Exception:
        pass

    await db.delete(source)
    await db.flush()
    await sync_system_context_groups(source.workspace_id, db)
