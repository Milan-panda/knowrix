from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token, get_current_user, hash_password, verify_password
from app.core.client_ip import get_client_ip
from app.core.database import get_db
from app.models.db import User, WorkspaceInvite, WorkspaceMember
from app.models.schemas import SignupRequest, SigninRequest, AuthResponse, UserResponse
from app.services.telegram_notify import notify_activity

router = APIRouter()


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    body: SignupRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    # Accept any pending workspace invites for this email (add as member, then delete invite)
    invites_result = await db.execute(select(WorkspaceInvite).where(WorkspaceInvite.email == body.email))
    for invite in invites_result.scalars().all():
        existing = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == invite.workspace_id,
                WorkspaceMember.user_id == user.id,
            )
        )
        if existing.scalar_one_or_none() is None:
            member = WorkspaceMember(
                workspace_id=invite.workspace_id,
                user_id=user.id,
                role=invite.role,
            )
            db.add(member)
        await db.delete(invite)

    token = create_access_token(data={"sub": str(user.id)})
    client_ip = get_client_ip(request)
    background_tasks.add_task(
        notify_activity,
        "Sign up",
        [f"email: {user.email}", f"user_id: {user.id}"],
        client_ip=client_ip,
    )
    return AuthResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/signin", response_model=AuthResponse)
async def signin(
    body: SigninRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token(data={"sub": str(user.id)})
    client_ip = get_client_ip(request)
    background_tasks.add_task(
        notify_activity,
        "Sign in",
        [f"email: {user.email}", f"user_id: {user.id}"],
        client_ip=client_ip,
    )
    return AuthResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user
