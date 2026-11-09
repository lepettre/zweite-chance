"""Ein Durchlauf: alle Maerkte abrufen -> Rohdaten sichern -> abgleichen -> speichern -> benachrichtigen.

  python -m tracker.run                      # Live-Abruf (GitHub Actions / lokal)
  python -m tracker.run --ingest snap.json   # Snapshot aus dem Lesezeichen-Skript einspielen
  python -m tracker.run --export             # nur CSV-Export neu erzeugen
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
import time
from datetime import datetime, timezone

from . import ikea_api, storage, watch
from .merge import merge, plausible
from .normalize import flatten, store_name, store_slug


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_settings() -> dict:
    s = storage.read_json(storage.ROOT / "config" / "settings.json", {})
    s.setdefault("country", "de")
    s.setdefault("language", "de")
    s.setdefault("store_slugs", {})
    s.setdefault("only_stores", [])
    s.setdefault("notify_on_first_run", False)
    return s


def store_map(raw_stores: list[dict], settings: dict) -> dict:
    out = {}
    for s in raw_stores:
        sid = str(s.get("store_id") or s.get("storeId") or s.get("id"))
        if s.get("active") is False:
            continue
        name = store_name(s.get("name") or s.get("displayName") or sid)
        out[sid] = {"id": sid, "name": name,
                    "slug": settings["store_slugs"].get(sid) or store_slug(name)}
    return out


def live_snapshot(settings: dict, prev_meta: dict) -> dict:
    ts = now()
    try:
        raw_stores = ikea_api.fetch_stores(settings["country"])
    except Exception as ex:
        print(f"[run] Marktliste nicht abrufbar ({ex}) - nutze letzte bekannte Liste.")
        raw_stores = [{"store_id": s["id"], "name": s["name"]} for s in prev_meta.get("stores", [])]
        if not raw_stores:
            raise
    stores = store_map(raw_stores, settings)
    if settings["only_stores"]:
        stores = {k: v for k, v in stores.items() if k in set(map(str, settings["only_stores"]))}
    results, blocked = {}, False
    for sid in sorted(stores):
        if blocked:
            results[sid] = {"ok": False, "error": "uebersprungen nach Sperre"}
            continue
        try:
            r = ikea_api.fetch_store(sid, settings["language"])
            results[sid] = {"ok": True, **r}
            print(f"[run] {stores[sid]['name']:<28} {sum(len(g.get('offers') or []) for g in r['content']):>5} Angebote")
        except ikea_api.BlockedError as ex:
            blocked = True
            results[sid] = {"ok": False, "error": str(ex)}
            print(f"[run] GESPERRT: {ex} - breche fuer diesen Lauf ab.")
        except Exception as ex:
            results[sid] = {"ok": False, "error": str(ex)[:300]}
            print(f"[run] Fehler {sid}: {ex}")
        ikea_api.pause()
    return {"schema": 1, "fetched_at": ts, "source": "actions", "country": settings["country"],
            "stores": list(stores.values()), "results": results}


def process(snapshot: dict, settings: dict, t0: float) -> dict:
    ts = snapshot["fetched_at"]
    meta = storage.read_json(storage.DATA / "meta.json", {})
    db = storage.load_db()
    first_run = not db
    stores = {str(s["id"]): s for s in snapshot["stores"]}
    for sid, s in stores.items():                      # Slug-Overrides auch fuer Ingest
        s["slug"] = settings["store_slugs"].get(sid) or s.get("slug") or store_slug(s["name"])

    records, ok = [], set()
    errors = []
    for sid, res in snapshot["results"].items():
        if not res.get("ok"):
            errors.append(f"{stores.get(sid, {}).get('name', sid)}: {res.get('error', '?')}")
            continue
        recs = flatten(res.get("content", []), sid, stores, settings["store_slugs"])
        if plausible(sid, len(recs), db):
            ok.add(sid)
        else:
            errors.append(f"{stores[sid]['name']}: leer trotz Bestand - nicht als Abverkauf gewertet")
        records.extend(recs)

    events = merge(db, records, ok, ts)
    months = storage.save_db(db, ts)
    storage.append_events(events)

    counts = {t: sum(1 for e in events if e["type"] == t)
              for t in ("new", "gone", "reappeared", "price_change", "changed")}
    active = sum(1 for o in db.values() if o["status"] == "active")

    # Watchlist + Telegram (Nachrichten werden nur vorgemerkt, gesendet wird nach dem Speichern)
    wl_path = storage.ROOT / "config" / "watchlist.json"
    rules, groups = watch.load_watchlist(wl_path)
    notified = storage.read_json(storage.STATE / "notified.json", {})
    hits = watch.find_hits(rules, db, events, notified, groups)
    outbox = storage.read_json(storage.STATE / "outbox.json", [])
    if first_run and not settings["notify_on_first_run"]:
        print(f"[watch] Erster Lauf: {len(hits)} Treffer werden still als bekannt markiert.")
        for *_, key in hits:
            notified[key] = ts
    else:
        queued = {m["key"] for m in outbox}
        outbox.extend(m for m in watch.queue(hits, notified, ts) if m["key"] not in queued)
    storage._dump(storage.STATE / "notified.json", notified)
    storage._dump(storage.STATE / "outbox.json", outbox)
    sent = len(outbox)
    storage._dump(storage.DATA / "watchlist.json",
                  {"rules": rules, "store_groups": groups})

    # Meta fuer die Web-App
    prev = {s["id"]: s for s in meta.get("stores", [])}
    per_store = {}
    for o in db.values():
        if o["status"] == "active":
            per_store[o["store_id"]] = per_store.get(o["store_id"], 0) + 1
    st_meta = []
    for sid, s in sorted(stores.items(), key=lambda kv: kv[1]["name"]):
        res = snapshot["results"].get(sid, {})
        p = prev.get(sid, {})
        st_meta.append({"id": sid, "name": s["name"], "slug": s["slug"], "active": per_store.get(sid, 0),
                        "last_ok": ts if sid in ok else p.get("last_ok"),
                        "last_error": None if sid in ok else (res.get("error") or p.get("last_error"))})
    for sid, p in prev.items():             # Maerkte, die gerade nicht gelistet sind, nicht vergessen
        if sid not in stores:
            st_meta.append({**p, "active": per_store.get(sid, 0)})
    run = {"ts": ts, "source": snapshot.get("source", "?"), "stores_total": len(stores),
           "stores_ok": len(ok), "stores_failed": len(stores) - len(ok), "offers_seen": len(records),
           "active": active, **counts, "duration_s": round(time.time() - t0, 1),
           "errors": " | ".join(errors)[:1000]}
    storage.append_csv(storage.DATA / "runs.csv", storage.RUN_FIELDS, [run])
    event_months = sorted(p.stem for p in (storage.DATA / "events").glob("*.csv"))
    current_path = storage.DATA / "current.json"
    current_version = hashlib.sha256(current_path.read_bytes()).hexdigest()[:16] if current_path.exists() else ts
    watch_payload = {"rules": rules, "store_groups": groups}
    watch_version = hashlib.sha256(json.dumps(watch_payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    storage._dump(storage.DATA / "meta.json", {
        "updated": ts, "last_run": run, "stores": st_meta, "archive_months": months,
        "event_months": event_months, "total_offers": len(db), "active": active,
        "current_version": current_version, "watchlist_version": watch_version,
        "hits_this_run": len(hits), "telegram_queued": sent, "schema": 1})
    print(f"[run] fertig: {len(ok)}/{len(stores)} Maerkte ok, {active} aktiv, {counts}, {len(hits)} Treffer")
    return run


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ingest", help="Snapshot-Datei (.json/.json.gz) aus dem Lesezeichen-Skript")
    ap.add_argument("--export", action="store_true", help="nur CSV-Export erzeugen")
    ap.add_argument("--no-export", action="store_true")
    ap.add_argument("--force", action="store_true", help="auch aeltere Snapshots einspielen")
    ap.add_argument("--send-outbox", action="store_true", help="vorgemerkte Telegram-Nachrichten senden")
    a = ap.parse_args(argv)
    settings = load_settings()
    t0 = time.time()
    if a.send_outbox:
        sent, left = watch.send_outbox(storage.STATE / "outbox.json")
        print(f"[watch] {sent} Telegram-Nachrichten gesendet, {left} bleiben im Postausgang.")
        return 0
    if a.export:
        storage.export_csv(storage.load_db(), now())
        return 0
    if a.ingest:
        op = gzip.open if a.ingest.endswith(".gz") else open
        with op(a.ingest, "rt", encoding="utf-8") as f:
            snap = json.load(f)
        snap.setdefault("source", "bookmarklet")
        last = storage.read_json(storage.DATA / "meta.json", {}).get("updated")
        if last and snap["fetched_at"] <= last and not a.force:
            print(f"[run] Snapshot ({snap['fetched_at']}) ist nicht neuer als der Bestand ({last}). "
                  "Abbruch - mit --force trotzdem einspielen.")
            return 1
    else:
        snap = live_snapshot(settings, storage.read_json(storage.DATA / "meta.json", {}))
    storage.write_raw(snap, snap["fetched_at"])
    run = process(snap, settings, t0)
    if not a.no_export or not (storage.DATA / "exports" / "offers_all.csv").exists():
        storage.export_csv(storage.load_db(), snap["fetched_at"])
    # Exit 2, wenn ueberhaupt kein Markt geklappt hat (Workflow wird rot -> Mail von GitHub)
    return 2 if run["stores_ok"] == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
