import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.auth import get_current_user
from app.core.database import get_db, async_session_factory
from app.core.workspace_auth import get_workspace_member
from app.models.db import User, ChatThread, ChatMessage
from app.models.schemas import (
    ChatRequest,
    ChatThreadResponse,
    ChatMessageResponse,
)
from app.retrieval.hybrid_search import hybrid_search
from app.services.llm_service import build_messages, stream_chat_completion

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Thread CRUD ───────────────────────────────────────────────────────────────

@router.get("/threads", response_model=list[ChatThreadResponse])
async def list_threads(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_workspace_member(workspace_id, current_user, db)
    result = await db.execute(
        select(ChatThread)
        .where(ChatThread.workspace_id == workspace_id, ChatThread.user_id == current_user.id)
        .order_by(ChatThread.updated_at.desc())
    )
    return result.scalars().all()


@router.get("/threads/{thread_id}/messages", response_model=list[ChatMessageResponse])
async def get_thread_messages(
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
    thread = result.scalar_one_or_none()
    if not thread or thread.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await get_workspace_member(thread.workspace_id, current_user, db)

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at)
    )
    return result.scalars().all()


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_thread(
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
    thread = result.scalar_one_or_none()
    if not thread or thread.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await get_workspace_member(thread.workspace_id, current_user, db)
    await db.delete(thread)


# ─── Chat with streaming + persistence ────────────────────────────────────────

async def _persist_and_stream(
    thread_id: UUID,
    chunks: list[dict],
    request: ChatRequest,
    history: list[dict],
):
    yield {"event": "sources", "data": json.dumps(chunks)}

    messages = build_messages(chunks, request.message, history)
    logger.info("Built %d messages for LLM, user msg length=%d", len(messages), len(messages[-1]["content"]))
    full_response = ""

    try:
        async for token in stream_chat_completion(messages):
            full_response += token
            yield {"event": "token", "data": json.dumps({"text": token})}
    except Exception as e:
        logger.error("LLM streaming failed: %s: %s", type(e).__name__, e)
        yield {"event": "token", "data": json.dumps({"text": f"\n\n[Error: LLM request failed — {e}]"})}

    logger.info("LLM response length: %d chars", len(full_response))

    # Persist assistant message after streaming completes
    if full_response:
        try:
            async with async_session_factory() as db:
                assistant_msg = ChatMessage(
                    thread_id=thread_id,
                    role="assistant",
                    content=full_response,
                    sources_json=json.dumps(chunks) if chunks else None,
                )
                db.add(assistant_msg)

                thread = (await db.execute(select(ChatThread).where(ChatThread.id == thread_id))).scalar_one()
                thread.updated_at = datetime.now(timezone.utc)
                await db.commit()
        except Exception as e:
            logger.error("Failed to persist assistant message: %s", e)

    yield {"event": "done", "data": json.dumps({"thread_id": str(thread_id)})}


@router.post("/")
async def chat(
    body: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_workspace_member(body.workspace_id, current_user, db)
    source_id_strs = [str(sid) for sid in body.source_ids] if body.source_ids else None

    # Resolve or create thread
    thread_id = body.thread_id
    if thread_id:
        result = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
        thread = result.scalar_one_or_none()
        if not thread or thread.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    else:
        title = body.message[:80] + ("..." if len(body.message) > 80 else "")
        thread = ChatThread(
            workspace_id=body.workspace_id,
            user_id=current_user.id,
            title=title,
        )
        db.add(thread)
        await db.flush()
        thread_id = thread.id

    # Persist user message
    user_msg = ChatMessage(thread_id=thread_id, role="user", content=body.message)
    db.add(user_msg)
    await db.commit()

    # Build history from DB for this thread
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at)
    )
    db_messages = result.scalars().all()
    history = [
        {"role": m.role, "content": m.content}
        for m in db_messages[:-1]  # exclude the user message we just added (it's in body.message)
    ][-20:]

    # Retrieve context (more chunks improve overview answers for broad questions)
    chunks = await hybrid_search(
        workspace_id=str(body.workspace_id),
        query=body.message,
        top_k=18,
        source_ids=source_id_strs,
    )

    return EventSourceResponse(
        _persist_and_stream(thread_id, chunks, body, history),
        headers={"X-Thread-Id": str(thread_id)},
    )
