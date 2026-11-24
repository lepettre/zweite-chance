"""Verschluesselte Ablage unter site/k (Branch gh-pages), gleiche Verschluesselung wie die Fundgrube-Daten."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

from tracker import crypto

from . import model

ROOT = Path(os.environ.get("TRACKER_ROOT", Path(__file__).resolve().parent.parent))
DATA = Path(os.environ["KATALOG_DATA"]) if os.environ.get("KATALOG_DATA") else ROOT / "site" / "k"


def write_bin(name: str, obj) -> str:
    blob = crypto.seal(obj, crypto.key_from_env())
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / name).write_bytes(blob)
    return hashlib.sha256(blob).hexdigest()[:16]


def read_bin(name: str, default=None):
    p = DATA / name
    return crypto.open_(p.read_bytes(), crypto.key_from_env()) if p.exists() else default


def load_db() -> dict:
    return model.unpack(read_bin("items.bin"))


def save_db(db: dict) -> str:
    return write_bin("items.bin", model.pack(db))
