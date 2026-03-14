"""
LLM service abstracted behind OpenRouter's OpenAI-compatible API.

To switch models: change LLM_MODEL in .env (or config).
To switch providers: change OPENROUTER_BASE_URL.
Core chat/retrieval logic never needs to change.
"""

import json
import logging
from typing import AsyncGenerator

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """\
You are ContextIQ, an expert developer assistant. You answer questions using ONLY the context chunks provided below. Follow these rules strictly:

1. **Use the context.** Every claim must be grounded in the provided source chunks. Cite with [Source N] notation.
2. **Overview vs detail.** For broad questions (e.g. "what is this about?", "summarize", "overview"), synthesize across the full context and mention the main topics or themes. Do not focus on a single narrow detail unless the user asks for it.
3. **Show code.** When the context contains relevant code, include it in fenced code blocks with the correct language tag and file path.
4. **Be precise.** Reference exact file paths, function names, and line numbers from the context when giving detailed answers.
5. **Admit gaps.** If the context does not contain enough information to answer, say so clearly — do NOT make up code or facts.
6. **Format well.** Use markdown headings, bullet lists, and code blocks for readability.
7. **Stay focused.** Answer only what was asked. Do not add unrelated information.\
"""


def _format_chunk(i: int, chunk: dict) -> str:
    """Format a single context chunk for the LLM prompt."""
    source_type = chunk.get("source_type", "")
    file_path = chunk.get("file_path", "")
    page_url = chunk.get("page_url", "")
    source_label = chunk.get("source_name", "unknown")

    if file_path:
        line_info = ""
        if chunk.get("line_start"):
            line_info = f", lines {chunk['line_start']}-{chunk['line_end']}"
        symbol = chunk.get("symbol_name") and chunk.get("symbol_type")
        symbol_info = f" ({chunk['symbol_type']} {chunk['symbol_name']})" if symbol else ""
        location = f"{file_path}{symbol_info}{line_info}"
    elif page_url:
        location = page_url
    else:
        location = source_label

    header = f"[Source {i}: {location}]"

    text = chunk.get("text", "")

    # Detect if text looks like code (has indentation, brackets, keywords)
    lang = ""
    if file_path:
        ext = file_path.rsplit(".", 1)[-1] if "." in file_path else ""
        lang_map = {
            "py": "python", "js": "javascript", "ts": "typescript",
            "tsx": "tsx", "jsx": "jsx", "go": "go", "rs": "rust",
            "java": "java", "rb": "ruby", "php": "php", "sh": "bash",
            "yaml": "yaml", "yml": "yaml", "sql": "sql", "html": "html",
            "css": "css", "scss": "scss", "vue": "vue", "svelte": "svelte",
        }
        lang = lang_map.get(ext, "")

    if lang:
        return f"{header}\n```{lang}\n{text}\n```"
    return f"{header}\n{text}"


def build_messages(
    chunks: list[dict],
    user_message: str,
    history: list[dict],
) -> list[dict]:
    """Build the message array for the LLM from context chunks + conversation."""
    if chunks:
        context_parts = [_format_chunk(i, c) for i, c in enumerate(chunks, 1)]
        context_block = "\n\n---\n\n".join(context_parts)
    else:
        context_block = "(No relevant context was found in the workspace for this query.)"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    for h in history[-10:]:
        messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})

    messages.append({
        "role": "user",
        "content": (
            f"<context>\n{context_block}\n</context>\n\n"
            f"Question: {user_message}"
        ),
    })

    return messages


async def stream_chat_completion(
    messages: list[dict],
) -> AsyncGenerator[str, None]:
    """
    Stream tokens from OpenRouter. Yields text chunks as they arrive.
    """
    settings = get_settings()

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.FRONTEND_URL,
        "X-Title": "ContextIQ",
    }

    payload = {
        "model": settings.LLM_MODEL,
        "messages": messages,
        "stream": True,
        "max_tokens": 4096,
        "temperature": 0.3,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0].get("delta", {})
                    text = delta.get("content")
                    if text:
                        yield text
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


async def chat_completion(messages: list[dict]) -> str:
    """Non-streaming completion (for simpler use cases)."""
    settings = get_settings()

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.FRONTEND_URL,
        "X-Title": "ContextIQ",
    }

    payload = {
        "model": settings.LLM_MODEL,
        "messages": messages,
        "max_tokens": 4096,
        "temperature": 0.3,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
