"""Verschluesselung aller veroeffentlichten Dateien (AES-256-GCM, Schluessel aus Passwort).

Format: b"ZC1" + IV (12 Byte) + Chiffrat. Klartext = gzip(JSON).
Muss mit docs/core.js (deriveKey / openBlob) uebereinstimmen.
"""
from __future__ import annotations

import functools
import gzip
import hashlib
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"ZC1"
ITERATIONS = 250_000
SALT = b"zc-site-v1"


@functools.lru_cache(maxsize=4)
def derive_key(password: str) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), SALT, ITERATIONS, 32)


def key_from_env() -> bytes:
    pw = os.environ.get("ZC_PASSWORD", "")
    if not pw:
        raise SystemExit("ZC_PASSWORD fehlt (Repository-Secret bzw. Umgebungsvariable).")
    return derive_key(pw)


def seal(obj, key: bytes) -> bytes:
    raw = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9, mtime=0)
    iv = os.urandom(12)
    return MAGIC + iv + AESGCM(key).encrypt(iv, raw, None)


def open_(blob: bytes, key: bytes):
    if blob[:3] != MAGIC:
        raise ValueError("Unbekanntes Dateiformat")
    raw = AESGCM(key).decrypt(blob[3:15], blob[15:], None)
    return json.loads(gzip.decompress(raw).decode("utf-8"))
