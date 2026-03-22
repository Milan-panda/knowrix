import ipaddress
import logging
from urllib.parse import quote

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# IP geolocation maps ISP/network ranges to regions — not GPS. VPNs, mobile CGNAT,
# and mis-set reverse-proxy headers can still skew results. IPinfo + correct
# client IP headers give the best practical signal without browser location permission.


async def _lookup_ipinfo(ip: str, token: str) -> str | None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            f"https://ipinfo.io/{quote(ip, safe='')}/json",
            params={"token": token},
        )
        r.raise_for_status()
        data = r.json()
        if data.get("bogon") or data.get("error"):
            return None
        city = data.get("city")
        region = data.get("region")
        country = data.get("country")
        loc = data.get("loc")
        org = data.get("org")
        parts = [p for p in (city, region, country) if p]
        if not parts and not loc:
            return None
        line = ", ".join(parts) if parts else ""
        if loc:
            line = f"{line} (~{loc})" if line else f"~{loc}"
        if org:
            line = f"{line} [{org}]" if line else org
        return line or None


async def _lookup_ip_api_com(ip: str) -> str:
    ip_param = quote(ip, safe="")
    async with httpx.AsyncClient(timeout=8.0) as client:
        r = await client.get(
            f"http://ip-api.com/json/{ip_param}",
            params={"fields": "status,message,country,regionName,city,isp"},
        )
        r.raise_for_status()
        data = r.json()
        if data.get("status") != "success":
            return str(data.get("message") or "lookup failed")
        parts = [data.get("city"), data.get("regionName"), data.get("country")]
        line = ", ".join(str(p) for p in parts if p) or "unknown"
        isp = data.get("isp")
        if isp:
            line = f"{line} [{isp}]"
        return line


async def _lookup_ip_location(ip: str) -> str:
    if not ip or ip == "unknown":
        return "unknown"

    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return "unknown"

    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
        return "local/private (no geo)"

    settings = get_settings()
    token = settings.IPINFO_TOKEN.strip()
    if token:
        try:
            out = await _lookup_ipinfo(ip, token)
            if out:
                return out
        except Exception:
            logger.exception("IPinfo geolocation failed for %s", ip)

    try:
        return await _lookup_ip_api_com(ip)
    except Exception:
        logger.exception("ip-api.com geolocation failed for %s", ip)
        return "unknown"


async def notify_activity(
    title: str,
    lines: list[str] | None = None,
    *,
    client_ip: str | None = None,
) -> None:
    settings = get_settings()
    tg_token = settings.TELEGRAM_BOT_TOKEN.strip()
    chat_id = settings.TELEGRAM_CHAT_ID.strip()
    if not tg_token or not chat_id:
        return

    ip = (client_ip or "").strip() or "unknown"
    location = await _lookup_ip_location(ip)
    merged: list[str] = [f"ip: {ip}", f"location: {location}"]
    if lines:
        merged.extend(lines)

    text = title + "\n" + "\n".join(merged)
    if len(text) > 4096:
        text = text[:4093] + "..."

    url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                url,
                json={"chat_id": chat_id, "text": text},
            )
            r.raise_for_status()
    except Exception:
        logger.exception("Telegram notify failed")
