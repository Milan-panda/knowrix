"""Workspace membership and role checks for RBAC."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import User, WorkspaceMember


async def get_workspace_member(
    workspace_id: UUID,
    current_user: User,
    db: AsyncSession,
) -> WorkspaceMember:
    """Return the current user's workspace membership or raise 403."""
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == current_user.id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a workspace member",
        )
    return member


async def require_workspace_role(
    workspace_id: UUID,
    current_user: User,
    db: AsyncSession,
    allowed_roles: list[str],
) -> WorkspaceMember:
    """Ensure user is a member and has one of the allowed roles; return membership or raise 403."""
    member = await get_workspace_member(workspace_id, current_user, db)
    if member.role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    return member
