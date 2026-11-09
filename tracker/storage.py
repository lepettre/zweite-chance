"""Dateiablage. Alles, was veroeffentlicht wird, liegt verschluesselt unter site/d/ (ZC_DATA).

 meta.bin       Maerkte, letzter Lauf, Abruf-Protokoll          (Web-App)
 current.bin    aktive Angebote                                   (Web-App)
 a-JJJJ-MM.bin  verschwundene Angebote nach Monat                (Web-App)
 watchlist.bin  zuletzt verwendete Merkliste (Sicherung)         (Web-App, nur Lesen)
 state.bin      bereits gemeldete Treffer + Telegram-Postausgang (nur Tracker)

site/ ist ein eigener Branch (gh-pages), der bei jedem Lauf ohne Verlauf neu veroeffentlicht wird.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

from . import crypto
from .pack import pack_offers, unpack_offers

ROOT = Path(os.environ.get("TRACKER_ROOT", Path(__file__).resolve().parent.parent))
DATA = Path(os.environ["ZC_DATA"]) if os.environ.get("ZC_DATA") else ROOT / "site" / "d"
LEGACY = ROOT / "docs" / "data"           # Altbestand (Klartext) - wird einmalig uebernommen
RAW_OUT = ROOT / "out" / "raw"
KEEP_RUNS = 400


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def month(ts: str | None) -> str:
    return (ts or "0000-00")[:7]


def write_bin(name: str, obj) -> str:
    """Verschluesselt schreiben; Rueckgabe = kurze Pruefsumme (fuer Cache-Busting)."""
    blob = crypto.seal(obj, crypto.key_from_env())
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / name).write_bytes(blob)
    return hashlib.sha256(blob).hexdigest()[:16]


def read_bin(name: str, default=None):
    p = DATA / name
    if not p.exists():
        return default
    return crypto.open_(p.read_bytes(), crypto.key_from_env())


def read_meta() -> dict:
    return read_bin("meta.bin", {}) or {}


def _stores_by_id(meta: dict) -> dict:
    return {str(s["id"]): s for s in meta.get("stores", [])}


def _load_legacy() -> dict:
    db = {}
    meta = read_json(LEGACY / "meta.json", {})
    last_ok = {s["id"]: s.get("last_ok") for s in meta.get("stores", [])}
    for o in read_json(LEGACY / "current.json", {}).get("offers", []):
        o.setdefault("last_seen", last_ok.get(o["store_id"]) or meta.get("updated") or o["first_seen"])
        o.setdefault("missing_runs", 0)
        db[o["id"]] = o
    for p in sorted((LEGACY / "archive").glob("*.json")):
        for o in read_json(p, {}).get("offers", []):
            db.setdefault(o["id"], o)
    for o in db.values():
        o.setdefault("price_history", [[o["first_seen"], o.get("price")]])
        o.setdefault("reappear_count", 0)
    return db


def load_meta_for_legacy() -> dict:
    return read_json(LEGACY / "meta.json", {})


def load_db() -> dict:
    meta = read_meta()
    if not meta and (LEGACY / "current.json").exists():
        print("[storage] Uebernehme Altbestand (Klartext) in das verschluesselte Format.")
        return _load_legacy()
    stores = _stores_by_id(meta)
    last_ok = {sid: s.get("last_ok") for sid, s in stores.items()}
    db = {}
    for o in unpack_offers(read_bin("current.bin"), stores, last_ok, meta.get("updated")):
        db[o["id"]] = o
    for p in sorted(DATA.glob("a-*.bin")):
        for o in unpack_offers(read_bin(p.name), stores, last_ok, meta.get("updated")):
            db.setdefault(o["id"], o)
    return db


def save_db(db: dict, ts: str, keep_days: int = 30) -> tuple[list[str], str]:
    """Aktive Angebote + Archiv schreiben. Archiv enthaelt nur die letzten keep_days Tage."""
    cutoff = (datetime.fromisoformat(ts) - timedelta(days=keep_days)).isoformat()
    for oid in [i for i, o in db.items() if o["status"] == "gone" and (o.get("gone_at") or "") < cutoff]:
        del db[oid]
    version = write_bin("current.bin", pack_offers([o for o in db.values() if o["status"] == "active"]))
    months: dict[str, list] = {}
    for o in db.values():
        if o["status"] == "gone":
            months.setdefault(month(o["gone_at"]), []).append(o)
    DATA.mkdir(parents=True, exist_ok=True)
    for p in DATA.glob("a-*.bin"):            # Monate ohne Eintraege entfernen
        if p.stem[2:] not in months:
            p.unlink()
    for m, offers in months.items():
        write_bin(f"a-{m}.bin", pack_offers(offers))
    return sorted(months), version


def write_raw(payload: dict, ts: str) -> Path:
    """Nur lokal/optional (Fehlersuche); wird nicht veroeffentlicht."""
    import gzip
    RAW_OUT.mkdir(parents=True, exist_ok=True)
    p = RAW_OUT / f"raw_{ts.replace(':', '').replace('-', '')[:15]}Z.json.gz"
    with gzip.open(p, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    return p
