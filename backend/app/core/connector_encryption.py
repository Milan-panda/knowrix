"""Encrypt/decrypt workspace connector tokens at rest using Fernet (symmetric)."""

import base64
import logging

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def _get_fernet() -> Fernet | None:
    settings = get_settings()
    key = (settings.ENCRYPTION_KEY or "").strip()
    if not key:
        return None
    try:
        # Accept raw base64 key or derive from shorter secret
        if len(key) == 44 and key.endswith("="):
            return Fernet(key.encode())
        # Derive 32-byte key for Fernet from arbitrary secret
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"contextiq_connector_tokens",
            iterations=100000,
        )
        derived = base64.urlsafe_b64encode(kdf.derive(key.encode()))
        return Fernet(derived)
    except Exception as e:
        logger.warning("Connector encryption key invalid: %s", e)
        return None


def encrypt_connector_token(plain: str) -> str:
    """Encrypt a token for storage. If no key configured, returns plaintext (dev only)."""
    f = _get_fernet()
    if not f:
        return plain
    try:
        return f.encrypt(plain.encode()).decode()
    except Exception as e:
        logger.warning("Encrypt failed: %s", e)
        return plain


def decrypt_connector_token(cipher: str) -> str | None:
    """Decrypt a stored token. If no key configured, returns cipher as-is (plaintext)."""
    if not (cipher or "").strip():
        return None
    f = _get_fernet()
    if not f:
        return cipher
    try:
        return f.decrypt(cipher.encode()).decode()
    except InvalidToken:
        logger.warning("Decrypt failed: invalid token or wrong key")
        return None
    except Exception as e:
        logger.warning("Decrypt failed: %s", e)
        return None
