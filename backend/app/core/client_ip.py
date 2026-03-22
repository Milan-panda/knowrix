import ipaddress

from fastapi import Request

# Prefer headers your edge sets (Cloudflare, nginx, then generic X-Forwarded-For).
_IP_HEADER_ORDER = (
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
)


def _normalize_ip(value: str) -> str:
    value = value.strip().strip('"')
    if not value:
        return value
    if value.startswith("[") and "]" in value:
        return value[1 : value.index("]")]
    if "%" in value:
        value = value.split("%", 1)[0]
    if value.count(":") == 1:
        host, _, maybe_port = value.partition(":")
        if maybe_port.isdigit():
            return host
    return value


def get_client_ip(request: Request) -> str:
    for name in _IP_HEADER_ORDER:
        raw = request.headers.get(name)
        if not raw:
            continue
        if name == "x-forwarded-for":
            candidates = [_normalize_ip(p) for p in raw.split(",")]
        else:
            candidates = [_normalize_ip(raw)]

        for candidate in candidates:
            if not candidate:
                continue
            try:
                ipaddress.ip_address(candidate)
                return candidate
            except ValueError:
                continue

    if request.client:
        return request.client.host
    return "unknown"
