import logging
import os
import subprocess
import tempfile
import uuid

from qdrant_client.models import PointStruct

from app.core.qdrant_client import get_qdrant
from app.ingestion.ast_chunker import chunk_file_ast
from app.ingestion.embedder import get_embeddings
from app.models.db import Source

logger = logging.getLogger(__name__)

MAX_FILES = 500
MAX_TOTAL_CHUNKS = 2000
CLONE_TIMEOUT_SEC = 120
EMBED_BATCH_SIZE = 100

CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java",
    ".cpp", ".c", ".h", ".hpp", ".rb", ".php", ".swift", ".kt",
    ".scala", ".sh", ".bash", ".yaml", ".yml", ".toml",
    ".sql", ".graphql", ".proto", ".css", ".scss", ".html",
    ".vue", ".svelte", ".zig", ".lua", ".r", ".jl",
    ".tf", ".hcl", ".Dockerfile",
}

SKIP_FILENAMES = {
    "license", "license.md", "license.txt",
    "changelog", "changelog.md",
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
    "poetry.lock", "pipfile.lock", "cargo.lock", "gemfile.lock",
    "composer.lock", "go.sum",
    ".gitignore", ".gitattributes", ".editorconfig",
    ".eslintignore", ".prettierignore", ".dockerignore",
    ".ds_store", "thumbs.db",
}

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    ".next", ".nuxt", "dist", "build", ".cache",
    ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    "vendor", "target", ".idea", ".vscode",
    "coverage", ".nyc_output", ".turbo",
}

MAX_FILE_SIZE = 100_000
MAX_CHUNK_LINES = 60
OVERLAP_LINES = 10


def _chunk_file_by_lines(
    content: str,
    file_path: str,
    max_lines: int = MAX_CHUNK_LINES,
) -> list[tuple[int, int, str]]:
    """Split file content into overlapping line-based chunks.
    Prepends file path header so the embedding captures file context.
    Returns (start_line, end_line, text_with_header).
    """
    lines = content.split("\n")
    chunks = []
    start = 0

    while start < len(lines):
        end = min(start + max_lines, len(lines))
        chunk_lines = lines[start:end]
        chunk_text = "\n".join(chunk_lines)

        header = f"# File: {file_path} (lines {start + 1}-{end})\n\n"
        chunks.append((start + 1, end, header + chunk_text))

        if end >= len(lines):
            break
        start = end - OVERLAP_LINES

    return chunks


def _clone_url_with_token(url: str, token: str | None) -> str:
    """Return URL with token for HTTPS clone when token is provided."""
    if not token or "github.com" not in url:
        return url
    if url.startswith("https://"):
        rest = url.replace("https://", "", 1)
        return f"https://{token}@{rest}"
    if url.startswith("http://"):
        rest = url.replace("http://", "", 1)
        return f"http://{token}@{rest}"
    return url


def _clone_repo(clone_url: str, tmpdir: str) -> None:
    """Clone repo with timeout. Raises if clone exceeds CLONE_TIMEOUT_SEC."""
    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", "--single-branch", clone_url, tmpdir],
            capture_output=True,
            text=True,
            timeout=CLONE_TIMEOUT_SEC,
            check=True,
        )
    except subprocess.TimeoutExpired:
        raise ValueError(f"Git clone timed out after {CLONE_TIMEOUT_SEC}s. Repository may be too large.")
    except subprocess.CalledProcessError as e:
        raise ValueError(f"Git clone failed: {e.stderr or str(e)}")
    except FileNotFoundError:
        raise ValueError("Git is not installed or not on PATH.")


async def ingest_github(source: Source, access_token: str | None = None) -> int:
    if not source.url:
        raise ValueError("GitHub source requires a URL")

    qdrant = get_qdrant()
    clone_url = _clone_url_with_token(source.url, access_token)

    with tempfile.TemporaryDirectory() as tmpdir:
        _clone_repo(clone_url, tmpdir)

        all_chunks: list[dict] = []
        file_count = 0

        for root, dirs, files in os.walk(tmpdir):
            dirs[:] = [d for d in dirs if d.lower() not in SKIP_DIRS]

            for filename in files:
                if file_count >= MAX_FILES or len(all_chunks) >= MAX_TOTAL_CHUNKS:
                    break

                if filename.lower() in SKIP_FILENAMES:
                    continue

                _, ext = os.path.splitext(filename)
                if ext.lower() not in CODE_EXTENSIONS:
                    continue

                filepath = os.path.join(root, filename)
                rel_path = os.path.relpath(filepath, tmpdir)

                try:
                    file_size = os.path.getsize(filepath)
                    if file_size > MAX_FILE_SIZE or file_size == 0:
                        continue

                    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                except Exception:
                    continue

                if not content.strip():
                    continue

                file_count += 1
                if file_count % 100 == 0:
                    logger.info("Processing file %d/%d (chunks so far: %d)", file_count, MAX_FILES, len(all_chunks))

                ast_chunks = chunk_file_ast(content, rel_path, ext)
                if ast_chunks:
                    for c in ast_chunks:
                        if len(all_chunks) >= MAX_TOTAL_CHUNKS:
                            break
                        all_chunks.append({
                            "text": c.text,
                            "source_id": str(source.id),
                            "workspace_id": str(source.workspace_id),
                            "source_type": "github",
                            "source_name": source.name,
                            "file_path": rel_path,
                            "line_start": c.line_start,
                            "line_end": c.line_end,
                            "symbol_name": c.symbol_name,
                            "symbol_type": c.symbol_type,
                        })
                else:
                    file_chunks = _chunk_file_by_lines(content, rel_path)
                    for line_start, line_end, chunk_text in file_chunks:
                        if len(all_chunks) >= MAX_TOTAL_CHUNKS:
                            break
                        all_chunks.append({
                            "text": chunk_text,
                            "source_id": str(source.id),
                            "workspace_id": str(source.workspace_id),
                            "source_type": "github",
                            "source_name": source.name,
                            "file_path": rel_path,
                            "line_start": line_start,
                            "line_end": line_end,
                        })

            if file_count >= MAX_FILES or len(all_chunks) >= MAX_TOTAL_CHUNKS:
                break

        if file_count >= MAX_FILES or len(all_chunks) >= MAX_TOTAL_CHUNKS:
            logger.warning(
                "Hit limit: files=%d (max %d), chunks=%d (max %d). Indexing partial repo.",
                file_count, MAX_FILES, len(all_chunks), MAX_TOTAL_CHUNKS,
            )
    if not all_chunks:
        return 0

    points: list[PointStruct] = []
    for i in range(0, len(all_chunks), EMBED_BATCH_SIZE):
        batch = all_chunks[i : i + EMBED_BATCH_SIZE]
        texts = [c["text"] for c in batch]
        embeddings = get_embeddings(texts)
        for chunk, embedding in zip(batch, embeddings):
            points.append(
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embedding,
                    payload=chunk,
                )
            )

    upsert_batch_size = 100
    for j in range(0, len(points), upsert_batch_size):
        qdrant.upsert(collection_name="contextiq_chunks", points=points[j : j + upsert_batch_size])

    return len(points)
