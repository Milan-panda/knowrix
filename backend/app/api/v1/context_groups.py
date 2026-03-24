from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.workspace_auth import get_workspace_member, require_workspace_role
from app.models.db import ContextGroup, ContextGroupSource, Source, User
from app.models.schemas import (
    ContextGroupCreate,
    ContextGroupResponse,
    ContextGroupSourcesUpdate,
    ContextGroupUpdate,
)
from app.services.context_groups import sync_system_context_groups

router = APIRouter()


async def _group_to_response(group: ContextGroup, db: AsyncSession) -> ContextGroupResponse:
    links_result = await db.execute(
        select(ContextGroupSource.source_id).where(ContextGroupSource.group_id == group.id)
    )
    source_ids = [sid for sid in links_result.scalars().all()]
    return ContextGroupResponse(
        id=group.id,
        workspace_id=group.workspace_id,
        name=group.name,
        is_system=group.is_system,
        source_ids=source_ids,
        sources_count=len(source_ids),
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


@router.get("", response_model=list[ContextGroupResponse])
async def list_context_groups(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_workspace_member(workspace_id, current_user, db)
    await sync_system_context_groups(workspace_id, db)

    result = await db.execute(
        select(ContextGroup)
        .where(ContextGroup.workspace_id == workspace_id)
        .order_by(ContextGroup.is_system.desc(), ContextGroup.name.asc())
    )
    groups = list(result.scalars().all())
    return [await _group_to_response(group, db) for group in groups]


@router.post("", response_model=ContextGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_context_group(
    body: ContextGroupCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(body.workspace_id, current_user, db, ["owner", "admin"])
    group = ContextGroup(
        workspace_id=body.workspace_id,
        name=body.name.strip(),
        is_system=0,
    )
    db.add(group)
    await db.flush()
    return await _group_to_response(group, db)


@router.patch("/{group_id}", response_model=ContextGroupResponse)
async def update_context_group(
    group_id: UUID,
    body: ContextGroupUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ContextGroup).where(ContextGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Context group not found")

    await require_workspace_role(group.workspace_id, current_user, db, ["owner", "admin"])
    if group.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System groups cannot be renamed")

    group.name = body.name.strip()
    await db.flush()
    return await _group_to_response(group, db)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_context_group(
    group_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ContextGroup).where(ContextGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Context group not found")

    await require_workspace_role(group.workspace_id, current_user, db, ["owner", "admin"])
    if group.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System groups cannot be deleted")

    await db.delete(group)


@router.put("/{group_id}/sources", response_model=ContextGroupResponse)
async def set_context_group_sources(
    group_id: UUID,
    body: ContextGroupSourcesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ContextGroup).where(ContextGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Context group not found")

    await require_workspace_role(group.workspace_id, current_user, db, ["owner", "admin"])
    if group.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System groups are auto-managed")

    if body.source_ids:
        src_result = await db.execute(
            select(Source.id).where(
                Source.workspace_id == group.workspace_id,
                Source.id.in_(body.source_ids),
            )
        )
        valid_source_ids = set(src_result.scalars().all())
        incoming = set(body.source_ids)
        if incoming != valid_source_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more sources are invalid for this workspace",
            )

    await db.execute(
        ContextGroupSource.__table__.delete().where(ContextGroupSource.group_id == group.id)
    )

    for source_id in body.source_ids:
        db.add(ContextGroupSource(group_id=group.id, source_id=source_id))

    await db.flush()
    return await _group_to_response(group, db)
