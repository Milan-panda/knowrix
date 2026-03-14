"""
AST-based code chunking for semantic retrieval.

Uses tree-sitter to split code by functions, classes, and methods instead of
fixed line windows. Falls back to line-based chunking when parsing fails or
the language is not supported.
"""

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# Max lines per AST chunk; larger blocks are sub-chunked by lines with overlap
MAX_AST_CHUNK_LINES = 80
OVERLAP_LINES = 10

# Extension -> tree-sitter language name (must match tree-sitter-language-pack)
EXT_TO_TS_LANG: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".kt": "kotlin",
    ".swift": "swift",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "c_sharp",
    ".scala": "scala",
    ".lua": "lua",
    ".zig": "zig",
}

# (node_type, symbol_type_label) for top-level chunkable nodes per language
# Order matters: more specific first if a node matches multiple
NODE_CONFIG: dict[str, list[tuple[str, str]]] = {
    "python": [
        ("class_definition", "class"),
        ("function_definition", "function"),
        ("async_function_definition", "function"),
    ],
    "javascript": [
        ("class_declaration", "class"),
        ("function_declaration", "function"),
        ("method_definition", "method"),
        ("arrow_function", "function"),  # top-level only when we walk
    ],
    "typescript": [
        ("class_declaration", "class"),
        ("function_declaration", "function"),
        ("method_definition", "method"),
        ("interface_declaration", "interface"),
        ("type_alias_declaration", "type"),
        ("arrow_function", "function"),
    ],
    "go": [
        ("type_declaration", "type"),
        ("function_declaration", "function"),
        ("method_declaration", "method"),
    ],
    "rust": [
        ("struct_item", "struct"),
        ("enum_item", "enum"),
        ("impl_item", "impl"),
        ("function_item", "function"),
        ("trait_item", "trait"),
    ],
    "java": [
        ("class_declaration", "class"),
        ("interface_declaration", "interface"),
        ("method_declaration", "method"),
        ("constructor_declaration", "constructor"),
    ],
    "ruby": [
        ("class", "class"),
        ("module", "module"),
        ("method", "method"),
    ],
    "php": [
        ("class_declaration", "class"),
        ("function_definition", "function"),
        ("method_declaration", "method"),
    ],
    "kotlin": [
        ("class_declaration", "class"),
        ("function_declaration", "function"),
    ],
    "swift": [
        ("class_declaration", "class"),
        ("function_declaration", "function"),
    ],
    "cpp": [
        ("class_specifier", "class"),
        ("function_definition", "function"),
    ],
    "c": [
        ("struct_specifier", "struct"),
        ("function_definition", "function"),
    ],
    "c_sharp": [
        ("class_declaration", "class"),
        ("method_declaration", "method"),
        ("constructor_declaration", "constructor"),
    ],
    "scala": [
        ("class_definition", "class"),
        ("object_definition", "object"),
        ("function_definition", "function"),
    ],
    "lua": [
        ("function_definition", "function"),
        ("local_function_definition", "function"),
    ],
    "zig": [
        ("fn_declaration", "function"),
        ("container_declaration", "struct"),
    ],
}


@dataclass
class ASTChunk:
    """A single semantic chunk from AST parsing."""
    line_start: int
    line_end: int
    text: str
    symbol_name: str | None
    symbol_type: str | None
    parent_scope: str | None  # e.g. class name for a method


def _get_parser_and_config(ext: str) -> tuple[Any, list[tuple[str, str]]] | None:
    """Return (parser, node_config) for the given extension, or None if unsupported."""
    ext_lower = ext.lower() if ext.startswith(".") else f".{ext.lower()}"
    lang = EXT_TO_TS_LANG.get(ext_lower)
    if not lang:
        return None
    config = NODE_CONFIG.get(lang)
    if not config:
        return None
    try:
        from tree_sitter_language_pack import get_parser
        parser = get_parser(lang)
        return (parser, config)
    except Exception as e:
        logger.debug("tree-sitter parser for %s not available: %s", lang, e)
        return None


def _node_name(node: Any, source_bytes: bytes) -> str | None:
    """Extract symbol name from a tree-sitter node (e.g. function/class name)."""
    name_node = node.child_by_field_name("name")
    if name_node is not None:
        return source_bytes[name_node.start_byte:name_node.end_byte].decode("utf-8", errors="replace")
    # Fallback: first identifier-like child (e.g. "def foo" -> "foo")
    for i in range(node.child_count):
        child = node.child(i)
        if child and child.type == "identifier":
            return source_bytes[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
    return None


def _collect_chunk_nodes(
    node: Any,
    source_bytes: bytes,
    config: list[tuple[str, str]],
    parent_scope: str | None,
    results: list[tuple[Any, str, str | None, str | None]],
) -> None:
    """Recursively collect nodes that match config (function/class/method etc.)."""
    if node is None:
        return
    for node_type, symbol_type in config:
        if node.type == node_type:
            name = _node_name(node, source_bytes)
            results.append((node, symbol_type, name, parent_scope))
            # For classes, recurse into body to get methods with class as parent_scope
            if node_type in ("class_definition", "class_declaration", "impl_item"):
                body = node.child_by_field_name("body") or node.child_by_field_name("declaration_list")
                if body:
                    for i in range(body.child_count):
                        _collect_chunk_nodes(
                            body.child(i), source_bytes, config,
                            name or parent_scope, results,
                        )
            break
    else:
        # Not a chunk root; recurse into children for nested definitions
        for i in range(node.child_count):
            _collect_chunk_nodes(node.child(i), source_bytes, config, parent_scope, results)


def _subchunk_by_lines(
    content: str,
    file_path: str,
    line_start: int,
    line_end: int,
    symbol_name: str | None,
    symbol_type: str | None,
) -> list[ASTChunk]:
    """Split a large block into overlapping line-based sub-chunks."""
    lines = content.split("\n")
    start_idx = line_start - 1
    end_idx = min(line_end, len(lines))
    chunk_list: list[ASTChunk] = []
    s = start_idx
    while s < end_idx:
        e = min(s + MAX_AST_CHUNK_LINES, end_idx)
        chunk_lines = lines[s:e]
        chunk_text = "\n".join(chunk_lines)
        header = f"# File: {file_path} (lines {s + 1}-{e})"
        if symbol_name and symbol_type:
            header += f"\n# Symbol: {symbol_name} ({symbol_type})"
        header += "\n\n"
        chunk_list.append(ASTChunk(
            line_start=s + 1,
            line_end=e,
            text=header + chunk_text,
            symbol_name=symbol_name,
            symbol_type=symbol_type,
            parent_scope=None,
        ))
        if e >= end_idx:
            break
        s = e - OVERLAP_LINES
    return chunk_list


def chunk_file_ast(
    content: str,
    file_path: str,
    ext: str,
) -> list[ASTChunk] | None:
    """
    Chunk a code file by AST (functions, classes, methods).

    Returns a list of ASTChunk, or None if the language is unsupported or
    parsing fails (caller should fall back to line-based chunking).
    """
    out = _get_parser_and_config(ext)
    if out is None:
        return None
    parser, config = out
    source_bytes = content.encode("utf-8")
    try:
        tree = parser.parse(source_bytes)
    except Exception as e:
        logger.debug("tree-sitter parse failed for %s: %s", file_path, e)
        return None

    root = tree.root_node
    if root is None or root.has_error:
        return None

    collected: list[tuple[Any, str, str | None, str | None]] = []
    _collect_chunk_nodes(root, source_bytes, config, None, collected)

    lines = content.split("\n")
    chunks: list[ASTChunk] = []

    for node, symbol_type, symbol_name, parent_scope in collected:
        start_line = node.start_point[0] + 1
        end_line = node.end_point[0] + 1
        snippet = source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
        header = f"# File: {file_path} (lines {start_line}-{end_line})"
        if symbol_name and symbol_type:
            header += f"\n# Symbol: {symbol_name} ({symbol_type})"
        if parent_scope:
            header += f"\n# In: {parent_scope}"
        header += "\n\n"

        num_lines = end_line - start_line + 1
        if num_lines <= MAX_AST_CHUNK_LINES:
            chunks.append(ASTChunk(
                line_start=start_line,
                line_end=end_line,
                text=header + snippet,
                symbol_name=symbol_name,
                symbol_type=symbol_type,
                parent_scope=parent_scope,
            ))
        else:
            chunks.extend(_subchunk_by_lines(
                content, file_path, start_line, end_line, symbol_name, symbol_type,
            ))

    if not chunks:
        return None
    return chunks
