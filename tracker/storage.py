"""Dateiablage unter docs/data (wird von GitHub Pages ausgeliefert)."""
from __future__ import annotations

import csv
import gzip
import io
import json
import os
from pathlib import Path

ROOT = Path(os.environ.get("TRACKER_ROOT", Path(__file__).resolve().parent.parent))
DATA = ROOT / "docs" / "data"
STATE = ROOT / "state"
RAW_OUT = ROOT / "out" / "raw"

EVENT_FIELDS = ["ts", "type", "id", "store_id", "article_number", "title", "price",
                "old_price", "new_price", "fields"]
RUN_FIELDS = ["ts", "source", "stores_total", "stores_ok", "stores_failed", "offers_seen",
              "active", "new", "gone", "reappeared", "price_change", "changed", "duration_s", "errors"]
EXPORT_FIELDS = ["id", "offer_uuid", "offer_number", "status", "store_id", "store", "title",
                 "product_description", "offer_description", "article_number", "condition",
                 "condition_code", "condition_description", "reason_discount", "additional_info",
                 "price", "original_price", "discount_eur", "discount_pct", "currency",
                 "first_seen", "last_seen", "gone_at", "days_listed",
                 "reappear_count", "price_changes", "first_price", "min_price", "link", "image"]


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if path.exists() and path.read_text(encoding="utf-8") == s:
        return
    path.write_text(s, encoding="utf-8")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def month(ts: str | None) -> str:
    return (ts or "0000-00")[:7]


def load_db() -> dict:
    db = {}
    meta = read_json(DATA / "meta.json", {})
    last_ok = {s["id"]: s.get("last_ok") for s in meta.get("stores", [])}
    for o in read_json(DATA / "current.json", {}).get("offers", []):
        # last_seen wird nur gespeichert, wenn das Angebot im letzten Abruf fehlte;
        # sonst ist es gleich dem letzten erfolgreichen Abruf seines Markts.
        o.setdefault("last_seen", last_ok.get(o["store_id"]) or meta.get("updated") or o["first_seen"])
        o.setdefault("missing_runs", 0)
        db[o["id"]] = o
    for p in sorted((DATA / "archive").glob("*.json")):
        for o in read_json(p, {}).get("offers", []):
            db.setdefault(o["id"], o)
    return db


VOLATILE = ("times_seen", "_hay")


def _slim(o: dict) -> dict:
    d = {k: v for k, v in o.items() if k not in VOLATILE}
    if d.get("status") == "active" and not d.get("missing_runs"):
        d.pop("last_seen", None)
        d.pop("missing_runs", None)
    return d


def _dump_offers(path: Path, head: dict, offers: list) -> None:
    """Ein Angebot pro Zeile, stabil sortiert -> kleine Git-Diffs."""
    path.parent.mkdir(parents=True, exist_ok=True)
    h = json.dumps(head, ensure_ascii=False, sort_keys=True)[:-1]
    lines = [json.dumps(_slim(o), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
             for o in sorted(offers, key=lambda o: o["id"])]
    s = h + ',"offers":[\n' + ",\n".join(lines) + "\n]}\n"
    if path.exists() and path.read_text(encoding="utf-8") == s:
        return
    path.write_text(s, encoding="utf-8")


def save_db(db: dict, ts: str) -> list[str]:
    active = [o for o in db.values() if o["status"] == "active"]
    _dump_offers(DATA / "current.json", {"stand": "siehe meta.json"}, active)
    months: dict[str, list] = {}
    for o in db.values():
        if o["status"] == "gone":
            months.setdefault(month(o["gone_at"]), []).append(o)
    arch = DATA / "archive"
    arch.mkdir(parents=True, exist_ok=True)
    for p in arch.glob("*.json"):           # Monate ohne Eintraege entfernen (z.B. nach Reaktivierung)
        if p.stem not in months:
            p.unlink()
    for m, offers in months.items():
        _dump_offers(arch / f"{m}.json", {"month": m}, offers)
    return sorted(months)


def append_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        if new:
            w.writeheader()
        w.writerows(rows)


def append_events(events: list[dict]) -> None:
    by_m: dict[str, list] = {}
    for e in events:
        by_m.setdefault(month(e["ts"]), []).append(e)
    for m, rows in by_m.items():
        append_csv(DATA / "events" / f"{m}.csv", EVENT_FIELDS, rows)


def _days(a, b):
    from datetime import datetime
    try:
        return round((datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() / 86400, 2)
    except Exception:
        return None


def export_csv(db: dict, ts: str) -> None:
    """Flache Gesamttabelle (ein Angebot = eine Zeile) fuer pandas/R/Excel/Datawrapper."""
    path = DATA / "exports" / "offers_all.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=EXPORT_FIELDS, extrasaction="ignore")
    w.writeheader()
    for o in sorted(db.values(), key=lambda o: (o["first_seen"], o["id"])):
        ph = [p for _, p in o.get("price_history", []) if p is not None]
        w.writerow({**o, "days_listed": _days(o["first_seen"], o.get("gone_at") or o["last_seen"]),
                    "price_changes": max(len(o.get("price_history", [])) - 1, 0),
                    "first_price": ph[0] if ph else None, "min_price": min(ph) if ph else None})
    path.write_text(buf.getvalue(), encoding="utf-8")
    with gzip.open(path.with_suffix(".csv.gz"), "wt", encoding="utf-8") as f:
        f.write(buf.getvalue())


def write_raw(payload: dict, ts: str) -> Path:
    RAW_OUT.mkdir(parents=True, exist_ok=True)
    p = RAW_OUT / f"raw_{ts.replace(':', '').replace('-', '')[:15]}Z.json.gz"
    with gzip.open(p, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    return p
