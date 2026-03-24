from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import AliasPath, BaseModel, EmailStr, Field


# ─── Auth ──────────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class SigninRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Workspaces ────────────────────────────────────────────────────────────────

class WorkspaceCreate(BaseModel):
    name: str


class WorkspaceResponse(BaseModel):
    id: UUID
    name: str
    owner_id: UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceWithRoleResponse(WorkspaceResponse):
    """Workspace with current user's role (for list)."""
    role: str  # owner | admin | member


class MemberResponse(BaseModel):
    user_id: UUID
    email: str
    name: Optional[str] = None
    role: str

    model_config = {"from_attributes": True}


class MemberOrInviteResponse(BaseModel):
    """List member (user_id set) or pending invite (user_id null, status='pending')."""
    user_id: Optional[UUID] = None
    email: str
    name: Optional[str] = None
    role: str
    status: str = "member"  # "member" | "pending"

    model_config = {"from_attributes": True}


class AddMemberResponse(BaseModel):
    """After adding: either a new member (user existed) or a pending invite (user not signed up yet)."""
    user_id: Optional[UUID] = None
    email: str
    name: Optional[str] = None
    role: str
    status: str  # "member" | "pending"


class MemberAddRequest(BaseModel):
    email: EmailStr
    role: str = "member"  # member | admin


class MemberUpdateRequest(BaseModel):
    role: str  # member | admin


# ─── Sources ───────────────────────────────────────────────────────────────────

class SourceCreate(BaseModel):
    workspace_id: UUID
    type: str  # pdf | github | web
    name: str
    url: Optional[str] = None
    max_depth: int = 1


class SourceResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    source_type: str = Field(validation_alias="type")
    name: str
    url: Optional[str] = None
    status: str
    created_at: datetime
    last_job_error: Optional[str] = None

    model_config = {"from_attributes": True, "populate_by_name": True}


# ─── Ingestion ─────────────────────────────────────────────────────────────────

class IngestionJobResponse(BaseModel):
    id: UUID
    source_id: UUID
    status: str
    error: Optional[str] = None
    chunks_count: int
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ─── Dashboard Stats ────────────────────────────────────────────────────────────

class DailyCount(BaseModel):
    date: str
    count: int

class WorkspaceStats(BaseModel):
    sources_count: int
    ready_sources_count: int
    threads_count: int
    total_chunks: int
    query_activity: list[DailyCount]
    source_timeline: list[DailyCount]


# ─── Chat ──────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    workspace_id: UUID
    thread_id: Optional[UUID] = None
    message: str
    source_ids: Optional[list[UUID]] = None
    reasoning: bool = False
    history: list[dict] = []


class ChatChunk(BaseModel):
    text: str
    source_type: str
    source_name: str
    file_path: Optional[str] = None
    line_start: Optional[int] = None
    line_end: Optional[int] = None


# ─── Chat Threads ──────────────────────────────────────────────────────────────

class ChatThreadResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    title: str
    selected_source_ids: Optional[list[UUID]] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageResponse(BaseModel):
    id: UUID
    thread_id: UUID
    role: str
    content: str
    sources_json: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Context Groups ────────────────────────────────────────────────────────────

class ContextGroupCreate(BaseModel):
    workspace_id: UUID
    name: str = Field(..., min_length=1, max_length=128)


class ContextGroupUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)


class ContextGroupSourcesUpdate(BaseModel):
    source_ids: list[UUID]


class ContextGroupResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    name: str
    is_system: bool
    source_ids: list[UUID] = []
    sources_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
