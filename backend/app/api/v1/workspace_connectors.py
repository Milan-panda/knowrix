"""
Workspace OAuth connectors (Notion, GitHub). Owner/admin only.
"""

import base64
import hashlib
import hmac
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.connector_encryption import decrypt_connector_token, encrypt_connector_token
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.workspace_auth import require_workspace_role
from app.models.db import User, WorkspaceConnector, WorkspaceMember

router = APIRouter()
settings = get_settings()

# ─── State (CSRF) ─────────────────────────────────────────────────────────────

def _encode_state(workspace_id: UUID, user_id: UUID) -> str:
    raw = f"{workspace_id}:{user_id}"
    sig = hmac.new(
        settings.NEXTAUTH_SECRET.encode(),
        raw.encode(),
        hashlib.sha256,
    ).hexdigest()[:16]
    return base64.urlsafe_b64encode(f"{raw}:{sig}".encode()).decode().rstrip("=")


def _decode_state(state: str) -> tuple[UUID, UUID] | None:
    try:
        padded = state + "=" * (4 - len(state) % 4)
        decoded = base64.urlsafe_b64decode(padded).decode()
        parts = decoded.rsplit(":", 1)
        if len(parts) != 2:
            return None
        raw, sig = parts
        expected = hmac.new(
            settings.NEXTAUTH_SECRET.encode(),
            raw.encode(),
            hashlib.sha256,
        ).hexdigest()[:16]
        if not hmac.compare_digest(sig, expected):
            return None
        ws_str, uid_str = raw.split(":", 1)
        return UUID(ws_str), UUID(uid_str)
    except Exception:
        return None


# ─── Schemas (no tokens in response) ───────────────────────────────────────────

def _connector_response(c: WorkspaceConnector) -> dict:
    return {
        "id": str(c.id),
        "workspace_id": str(c.workspace_id),
        "provider": c.provider,
        "meta": c.meta,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


# ─── List ────────────────────────────────────────────────────────────────────

@router.get("/{workspace_id}/connectors")
async def list_connectors(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])
    result = await db.execute(
        select(WorkspaceConnector).where(WorkspaceConnector.workspace_id == workspace_id)
    )
    connectors = result.scalars().all()
    return [_connector_response(c) for c in connectors]


# ─── GitHub OAuth ─────────────────────────────────────────────────────────────

GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize"
GITHUB_ACCESS_TOKEN = "https://github.com/login/oauth/access_token"
GITHUB_USER = "https://api.github.com/user"


@router.get("/connectors/github/callback")
async def github_callback_no_workspace(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Callback URL without workspace_id in path (for OAuth redirect URI registration)."""
    if error:
        decoded = _decode_state(state) if state else None
        workspace_id = decoded[0] if decoded else None
        frontend = settings.FRONTEND_URL.rstrip("/")
        url = f"{frontend}/workspace/{workspace_id}/connectors?error=access_denied" if workspace_id else f"{frontend}"
        return RedirectResponse(url=url)
    if not code or not state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code or state")
    decoded = _decode_state(state)
    if not decoded:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid state")
    workspace_id, user_id = decoded
    member_result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.role.in_(["owner", "admin"]),
        )
    )
    if member_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GITHUB_ACCESS_TOKEN,
            params={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": settings.github_connector_redirect_uri,
            },
            headers={"Accept": "application/json"},
        )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="GitHub token exchange failed")
    data = token_resp.json()
    access_token = data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=data.get("error", "No access_token"))
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            GITHUB_USER,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    meta = {}
    if user_resp.status_code == 200:
        u = user_resp.json()
        meta = {"login": u.get("login"), "avatar_url": u.get("avatar_url"), "name": u.get("name")}
    result = await db.execute(
        select(WorkspaceConnector).where(
            WorkspaceConnector.workspace_id == workspace_id,
            WorkspaceConnector.provider == "github",
        )
    )
    existing = result.scalar_one_or_none()
    encrypted = encrypt_connector_token(access_token)
    if existing:
        existing.access_token = encrypted
        existing.meta = meta or existing.meta
        await db.commit()
    else:
        conn = WorkspaceConnector(
            workspace_id=workspace_id,
            provider="github",
            access_token=encrypted,
            meta=meta or None,
        )
        db.add(conn)
        await db.commit()
    frontend = settings.FRONTEND_URL.rstrip("/")
    return RedirectResponse(url=f"{frontend}/workspace/{workspace_id}/connectors?connected=github")


@router.get("/{workspace_id}/connectors/github/authorize")
async def github_authorize(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub OAuth is not configured",
        )
    state = _encode_state(workspace_id, current_user.id)
    params = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": settings.github_connector_redirect_uri,
        "scope": "repo read:user",
        "state": state,
    }
    url = f"{GITHUB_AUTHORIZE}?" + "&".join(f"{k}={v}" for k, v in params.items())
    return JSONResponse(status_code=200, content={"redirect_url": url})


@router.get("/{workspace_id}/connectors/github/callback")
async def github_callback(
    workspace_id: UUID,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    if error:
        frontend = settings.FRONTEND_URL.rstrip("/")
        return RedirectResponse(url=f"{frontend}/workspace/{workspace_id}/connectors?error=access_denied")
    if not code or not state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code or state")
    decoded = _decode_state(state)
    if not decoded or decoded[0] != workspace_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid state")
    user_id = decoded[1]
    member_result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.role.in_(["owner", "admin"]),
        )
    )
    if member_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GITHUB_ACCESS_TOKEN,
            params={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": settings.github_connector_redirect_uri,
            },
            headers={"Accept": "application/json"},
        )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="GitHub token exchange failed")
    data = token_resp.json()
    access_token = data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=data.get("error", "No access_token"))

    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            GITHUB_USER,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    meta = {}
    if user_resp.status_code == 200:
        u = user_resp.json()
        meta = {"login": u.get("login"), "avatar_url": u.get("avatar_url"), "name": u.get("name")}

    result = await db.execute(
        select(WorkspaceConnector).where(
            WorkspaceConnector.workspace_id == workspace_id,
            WorkspaceConnector.provider == "github",
        )
    )
    existing = result.scalar_one_or_none()
    encrypted = encrypt_connector_token(access_token)
    if existing:
        existing.access_token = encrypted
        existing.meta = meta or existing.meta
        await db.commit()
    else:
        conn = WorkspaceConnector(
            workspace_id=workspace_id,
            provider="github",
            access_token=encrypted,
            meta=meta or None,
        )
        db.add(conn)
        await db.commit()

    frontend = settings.FRONTEND_URL.rstrip("/")
    return RedirectResponse(url=f"{frontend}/workspace/{workspace_id}/connectors?connected=github")


# ─── Notion OAuth ─────────────────────────────────────────────────────────────

NOTION_AUTHORIZE = "https://api.notion.com/v1/oauth/authorize"
NOTION_TOKEN = "https://api.notion.com/v1/oauth/token"


@router.get("/connectors/notion/callback")
async def notion_callback_no_workspace(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Callback URL without workspace_id in path (for OAuth redirect URI registration)."""
    if error:
        decoded = _decode_state(state) if state else None
        workspace_id = decoded[0] if decoded else None
        frontend = settings.FRONTEND_URL.rstrip("/")
        url = f"{frontend}/workspace/{workspace_id}/connectors?error=access_denied" if workspace_id else f"{frontend}"
        return RedirectResponse(url=url)
    if not code or not state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code or state")
    decoded = _decode_state(state)
    if not decoded:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid state")
    workspace_id, user_id = decoded
    member_result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.role.in_(["owner", "admin"]),
        )
    )
    if member_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    basic = base64.b64encode(
        f"{settings.NOTION_CLIENT_ID}:{settings.NOTION_CLIENT_SECRET}".encode()
    ).decode()
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            NOTION_TOKEN,
            json={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.notion_redirect_uri,
            },
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28",
            },
        )
    if token_resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=token_resp.text or "Notion token exchange failed",
        )
    data = token_resp.json()
    access_token = data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No access_token from Notion")
    workspace_blob = data.get("workspace")
    workspace_name = None
    if isinstance(workspace_blob, dict):
        workspace_name = workspace_blob.get("name")
    meta = {}
    if workspace_name:
        meta["workspace_name"] = workspace_name
    result = await db.execute(
        select(WorkspaceConnector).where(
            WorkspaceConnector.workspace_id == workspace_id,
            WorkspaceConnector.provider == "notion",
        )
    )
    existing = result.scalar_one_or_none()
    encrypted = encrypt_connector_token(access_token)
    if existing:
        existing.access_token = encrypted
        if meta:
            existing.meta = {**(existing.meta or {}), **meta}
        await db.commit()
    else:
        conn = WorkspaceConnector(
            workspace_id=workspace_id,
            provider="notion",
            access_token=encrypted,
            meta=meta or None,
        )
        db.add(conn)
        await db.commit()
    frontend = settings.FRONTEND_URL.rstrip("/")
    return RedirectResponse(url=f"{frontend}/workspace/{workspace_id}/connectors?connected=notion")


@router.get("/{workspace_id}/connectors/notion/authorize")
async def notion_authorize(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])
    if not settings.NOTION_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Notion OAuth is not configured",
        )
    state = _encode_state(workspace_id, current_user.id)
    redirect_uri = settings.notion_redirect_uri
    params = {
        "client_id": settings.NOTION_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "owner": "user",
        "state": state,
    }
    url = f"{NOTION_AUTHORIZE}?" + "&".join(f"{k}={v}" for k, v in params.items())
    return JSONResponse(status_code=200, content={"redirect_url": url})


@router.get("/{workspace_id}/connectors/notion/callback")
async def notion_callback(
    workspace_id: UUID,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    if error:
        frontend = settings.FRONTEND_URL.rstrip("/")
        return RedirectResponse(url=f"{frontend}/workspace/{workspace_id}/connectors?error=access_denied")
    if not code or not state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code or state")
    decoded = _decode_state(state)
    if not decoded or decoded[0] != workspace_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid state")
    user_id = decoded[1]
    member_result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.role.in_(["owner", "admin"]),
        )
    )
    if member_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    basic = base64.b64encode(
        f"{settings.NOTION_CLIENT_ID}:{settings.NOTION_CLIENT_SECRET}".encode()
    ).decode()
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            NOTION_TOKEN,
            json={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.notion_redirect_uri,
            },
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28",
            },
        )
    if token_resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=token_resp.text or "Notion token exchange failed",
        )
    data = token_resp.json()
    access_token = data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No access_token from Notion")
    workspace_blob = data.get("workspace")
    workspace_name = None
    if isinstance(workspace_blob, dict):
        workspace_name = workspace_blob.get("name")
    meta = {}
    if workspace_name:
        meta["workspace_name"] = workspace_name

    result = await db.execute(
        select(WorkspaceConnector).where(
            WorkspaceConnector.workspace_id == workspace_id,
            WorkspaceConnector.provider == "notion",
        )
    )
    existing = result.scalar_one_or_none()
    encrypted = encrypt_connector_token(access_token)
    if existing:
        existing.access_token = encrypted
        if meta:
            existing.meta = {**(existing.meta or {}), **meta}
        await db.commit()
    else:
        conn = WorkspaceConnector(
            workspace_id=workspace_id,
            provider="notion",
            access_token=encrypted,
            meta=meta or None,
        )
        db.add(conn)
        await db.commit()

    frontend = settings.FRONTEND_URL.rstrip("/")
    return RedirectResponse(url=f"{frontend}/workspace/{workspace_id}/connectors?connected=notion")


# ─── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/{workspace_id}/connectors/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_connector(
    workspace_id: UUID,
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if provider not in ("github", "notion"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown provider")
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])
    result = await db.execute(
        select(WorkspaceConnector).where(
            WorkspaceConnector.workspace_id == workspace_id,
            WorkspaceConnector.provider == provider,
        )
    )
    conn = result.scalar_one_or_none()
    if conn:
        await db.delete(conn)
        await db.commit()


# ─── Notion: list pages ───────────────────────────────────────────────────────

def _extract_page(item: dict) -> dict:
    """Pull the fields we need from a Notion page object."""
    title = ""
    props = item.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            title_parts = prop.get("title", [])
            title = "".join(t.get("plain_text", "") for t in title_parts)
            break
    if not title:
        title = "Untitled"

    icon_emoji = None
    icon = item.get("icon")
    if icon and icon.get("type") == "emoji":
        icon_emoji = icon.get("emoji")

    parent = item.get("parent", {})
    parent_id = None
    if parent.get("type") == "page_id":
        parent_id = parent["page_id"]

    return {
        "id": item["id"],
        "title": title,
        "icon": icon_emoji,
        "url": item.get("url", ""),
        "last_edited": item.get("last_edited_time"),
        "parent_id": parent_id,
        "children": [],
    }


@router.get("/{workspace_id}/connectors/notion/pages")
async def list_notion_pages(
    workspace_id: UUID,
    q: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List Notion pages as a tree (parent → children), with optional search."""
    await require_workspace_role(workspace_id, current_user, db, ["owner", "admin"])
    result = await db.execute(
        select(WorkspaceConnector).where(
            WorkspaceConnector.workspace_id == workspace_id,
            WorkspaceConnector.provider == "notion",
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Notion not connected")

    token = decrypt_connector_token(conn.access_token)
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }

    body: dict = {
        "filter": {"value": "page", "property": "object"},
        "page_size": 100,
    }
    if q.strip():
        body["query"] = q.strip()

    all_items: list[dict] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        while True:
            resp = await client.post("https://api.notion.com/v1/search", headers=headers, json=body)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Notion API error")
            data = resp.json()
            all_items.extend(data.get("results", []))
            if not data.get("has_more") or not data.get("next_cursor") or len(all_items) >= 200:
                break
            body["start_cursor"] = data["next_cursor"]

    by_id: dict[str, dict] = {}
    for item in all_items:
        page = _extract_page(item)
        by_id[page["id"]] = page

    roots: list[dict] = []
    for page in by_id.values():
        pid = page["parent_id"]
        if pid and pid in by_id:
            by_id[pid]["children"].append(page)
        else:
            roots.append(page)

    def _sort(nodes: list[dict]) -> list[dict]:
        nodes.sort(key=lambda n: n["title"].lower())
        for n in nodes:
            if n["children"]:
                _sort(n["children"])
        return nodes

    return {"pages": _sort(roots)}
