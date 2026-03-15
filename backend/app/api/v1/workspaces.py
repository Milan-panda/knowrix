from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.workspace_auth import get_workspace_member, require_workspace_role
from app.models.db import (
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceInvite,
    Source,
    IngestionJob,
    ChatThread,
    ChatMessage,
)
from app.models.schemas import (
    WorkspaceCreate,
    WorkspaceResponse,
    WorkspaceWithRoleResponse,
    WorkspaceStats,
    DailyCount,
    MemberResponse,
    MemberOrInviteResponse,
    AddMemberResponse,
    MemberAddRequest,
    MemberUpdateRequest,
)

router = APIRouter()


@router.post("", response_model=WorkspaceResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace = Workspace(name=body.name, owner_id=current_user.id)
    db.add(workspace)
    await db.flush()

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=current_user.id,
        role="owner",
    )
    db.add(member)
    await db.flush()

    return workspace


@router.get("", response_model=list[WorkspaceWithRoleResponse])
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, Workspace.id == WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id == current_user.id)
    )
    rows = result.all()
    return [
        WorkspaceWithRoleResponse(
            id=w.id, name=w.name, owner_id=w.owner_id, created_at=w.created_at, role=role
        )
        for w, role in rows
    ]


@router.get("/{workspace_id}", response_model=WorkspaceWithRoleResponse)
async def get_workspace(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, Workspace.id == WorkspaceMember.workspace_id)
        .where(
            Workspace.id == workspace_id,
            WorkspaceMember.user_id == current_user.id,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    workspace, role = row
    return WorkspaceWithRoleResponse(
        id=workspace.id,
        name=workspace.name,
        owner_id=workspace.owner_id,
        created_at=workspace.created_at,
        role=role,
    )


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.owner_id == current_user.id,
        )
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found or not owner")
    await db.delete(workspace)


# ─── Members ───────────────────────────────────────────────────────────────────

@router.get("/{workspace_id}/members", response_model=list[MemberOrInviteResponse])
async def list_members(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_workspace_member(workspace_id, current_user, db)
    result = await db.execute(
        select(WorkspaceMember, User)
        .join(User, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace_id)
    )
    members = [
        MemberOrInviteResponse(
            user_id=wm.user_id, email=u.email, name=u.name, role=wm.role, status="member"
        )
        for wm, u in result.all()
    ]
    invites_result = await db.execute(
        select(WorkspaceInvite).where(WorkspaceInvite.workspace_id == workspace_id)
    )
    for inv in invites_result.scalars().all():
        members.append(
            MemberOrInviteResponse(
                user_id=None, email=inv.email, name=None, role=inv.role, status="pending"
            )
        )
    return members


@router.post("/{workspace_id}/members", response_model=AddMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    workspace_id: UUID,
    body: MemberAddRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])
    if body.role not in ("member", "admin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role must be member or admin")

    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is not None:
        # User exists: add as member (or 409 if already a member)
        existing = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user.id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a member")
        member = WorkspaceMember(workspace_id=workspace_id, user_id=user.id, role=body.role)
        db.add(member)
        await db.flush()
        return AddMemberResponse(
            user_id=user.id, email=user.email, name=user.name, role=member.role, status="member"
        )
    else:
        # User not signed up yet: create a pending invite (they'll be added when they sign up)
        existing_invite = await db.execute(
            select(WorkspaceInvite).where(
                WorkspaceInvite.workspace_id == workspace_id,
                WorkspaceInvite.email == body.email,
            )
        )
        if existing_invite.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invite already sent to this email")
        invite = WorkspaceInvite(
            workspace_id=workspace_id,
            email=body.email,
            role=body.role,
            invited_by_id=current_user.id,
        )
        db.add(invite)
        await db.flush()
        return AddMemberResponse(
            user_id=None, email=invite.email, name=None, role=invite.role, status="pending"
        )


@router.delete("/{workspace_id}/invites", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_invite(
    workspace_id: UUID,
    email: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a pending invite (owner/admin only)."""
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])
    result = await db.execute(
        select(WorkspaceInvite).where(
            WorkspaceInvite.workspace_id == workspace_id,
            WorkspaceInvite.email == email,
        )
    )
    invite = result.scalar_one_or_none()
    if invite is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    await db.delete(invite)


@router.patch("/{workspace_id}/members/{user_id}", response_model=MemberResponse)
async def update_member_role(
    workspace_id: UUID,
    user_id: UUID,
    body: MemberUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])
    if body.role not in ("member", "admin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role must be member or admin")

    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if workspace.owner_id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change owner role")

    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    member.role = body.role
    await db.commit()
    await db.refresh(member)
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    return MemberResponse(user_id=user.id, email=user.email, name=user.name, role=member.role)


@router.delete("/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    workspace_id: UUID,
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])

    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if workspace.owner_id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove workspace owner")

    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    await db.delete(member)
    await db.commit()


@router.get("/{workspace_id}/stats", response_model=WorkspaceStats)
async def get_workspace_stats(
    workspace_id: UUID,
    scope: Literal["workspace", "personal"] = "workspace",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stats: owner can use scope=workspace (all) or scope=personal (own only); admin/member always get personal."""
    member = await get_workspace_member(workspace_id, current_user, db)
    use_cumulative = member.role == "owner" and scope == "workspace"

    sources_result = await db.execute(
        select(Source).where(Source.workspace_id == workspace_id)
    )
    sources = sources_result.scalars().all()
    sources_count = len(sources)
    ready_sources_count = sum(1 for s in sources if s.status == "ready")
    source_ids = [s.id for s in sources]

    total_chunks = 0
    if source_ids:
        # Sum chunks from the latest *completed* job per source only (current index state).
        # Reindexes replace chunks in Qdrant, so we must not sum all jobs or we double-count.
        jobs_result = await db.execute(
            select(IngestionJob)
            .where(
                IngestionJob.source_id.in_(source_ids),
                IngestionJob.status == "completed",
            )
            .order_by(IngestionJob.completed_at.desc().nulls_last())
        )
        seen_source_ids = set()
        for job in jobs_result.scalars().all():
            if job.source_id not in seen_source_ids:
                seen_source_ids.add(job.source_id)
                total_chunks += job.chunks_count or 0

    # Threads: cumulative (all in workspace) or personal (only current user's)
    if use_cumulative:
        threads_result = await db.execute(
            select(func.count(ChatThread.id)).where(ChatThread.workspace_id == workspace_id)
        )
    else:
        threads_result = await db.execute(
            select(func.count(ChatThread.id)).where(
                ChatThread.workspace_id == workspace_id,
                ChatThread.user_id == current_user.id,
            )
        )
    threads_count = threads_result.scalar() or 0

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=13)

    # Query activity: cumulative (all messages in workspace) or personal (only current user's threads)
    if use_cumulative:
        msgs_result = await db.execute(
            select(
                func.date(ChatMessage.created_at).label("day"),
                func.count(ChatMessage.id).label("cnt"),
            )
            .join(ChatThread, ChatMessage.thread_id == ChatThread.id)
            .where(
                ChatThread.workspace_id == workspace_id,
                ChatMessage.role == "user",
                ChatMessage.created_at >= cutoff,
            )
            .group_by(func.date(ChatMessage.created_at))
        )
    else:
        msgs_result = await db.execute(
            select(
                func.date(ChatMessage.created_at).label("day"),
                func.count(ChatMessage.id).label("cnt"),
            )
            .join(ChatThread, ChatMessage.thread_id == ChatThread.id)
            .where(
                ChatThread.workspace_id == workspace_id,
                ChatThread.user_id == current_user.id,
                ChatMessage.role == "user",
                ChatMessage.created_at >= cutoff,
            )
            .group_by(func.date(ChatMessage.created_at))
        )
    msg_rows = {str(row.day): row.cnt for row in msgs_result}

    src_result = await db.execute(
        select(
            func.date(Source.created_at).label("day"),
            func.count(Source.id).label("cnt"),
        )
        .where(
            Source.workspace_id == workspace_id,
            Source.created_at >= cutoff,
        )
        .group_by(func.date(Source.created_at))
    )
    src_rows = {str(row.day): row.cnt for row in src_result}

    query_activity = []
    source_timeline = []
    cumulative = sources_count - sum(src_rows.values())
    for i in range(14):
        day = (cutoff + timedelta(days=i)).strftime("%Y-%m-%d")
        query_activity.append(DailyCount(date=day, count=msg_rows.get(day, 0)))
        cumulative += src_rows.get(day, 0)
        source_timeline.append(DailyCount(date=day, count=cumulative))

    return WorkspaceStats(
        sources_count=sources_count,
        ready_sources_count=ready_sources_count,
        threads_count=threads_count,
        total_chunks=total_chunks,
        query_activity=query_activity,
        source_timeline=source_timeline,
    )
