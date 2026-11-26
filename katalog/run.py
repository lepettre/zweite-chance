"""Katalog-Lauf: alle Kategorien abrufen -> abgleichen -> verschluesselt speichern.

  python -m katalog.run                      # alle Kategorien
  python -m katalog.run --limit 20           # Probelauf mit 20 Kategorien (aendert den Bestand nicht ausser Neuzugaengen)
  python -m katalog.run --sitemap --fill 300 # zusaetzlich Luecken gegen die Produkt-Sitemaps, 300 Luecken-Artikel nachladen
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import api, model, store

MIN_SHARE = 0.7        # weniger als 70 % des bekannten aktiven Bestands gesehen -> Lauf zaehlt als unvollstaendig


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def collect(keys: list[str], workers: int = 3) -> tuple[list[dict], list[str], bool]:
    """-> (Artikel, fehlgeschlagene Kategorien, gesperrt?)"""
    items, failed, blocked = [], [], threading.Event()
    lock = threading.Lock()

    def one(key: str) -> None:
        if blocked.is_set():
            with lock:
                failed.append(key)
            return
        try:
            page = api.fetch_category(key)
            got = [x for x in (model.parse_item(i) for i in page.get("productWindow") or []) if x]
            with lock:
                items.extend(got)
        except api.Blocked as ex:
            blocked.set()
            print(f"[katalog] GESPERRT: {ex}")
            with lock:
                failed.append(key)
        except FileNotFoundError:
            pass                                   # Kategorie existiert nicht (mehr): kein Fehler, nur uebersprungen
        except Exception as ex:
            print(f"[katalog] Kategorie {key}: {ex}")
            with lock:
                failed.append(key)
        api.pause()

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(one, keys))
    return items, failed, blocked.is_set()


def sitemap_ids() -> dict[str, str]:
    out: dict[str, str] = {}
    for url in api.sitemap_urls():
        out.update(api.parse_sitemap(api.get(url, timeout=300).decode("utf-8", "replace")))
        api.pause()
    return out


def gaps(db: dict, in_map: dict[str, str]) -> dict:
    active = {i for i, o in db.items() if o["status"] == "active"}
    only_map = sorted(set(in_map) - set(db))
    only_list = sorted(active - set(in_map))
    return {"sitemap": len(in_map), "only_sitemap": len(only_map), "only_list": len(only_list),
            "only_sitemap_ids": only_map[:300], "only_list_ids": only_list[:300]}


def fill(db: dict, ids: list[str], in_map: dict[str, str], day: str, limit: int, workers: int = 3) -> int:
    """Luecken-Artikel (nur in der Sitemap) ueber ihre Produkt-JSON nachladen (Einzelartikel und Sets).
    Artikel ohne Treffer werden als "stub" vermerkt, damit sie nicht jeden Tag neu versucht werden."""
    todo = [i for i in ids if i not in db][:limit]
    results: dict[str, dict | None] = {}
    blocked = threading.Event()

    def one(art: str) -> None:
        if blocked.is_set():
            return
        try:
            results[art] = api.fetch_product_json(art)
        except api.Blocked:
            blocked.set()
        except Exception:
            results[art] = None
        api.pause()

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(one, todo))
    if blocked.is_set() and not results:
        raise api.Blocked("Produkt-JSON gesperrt")
    done = 0
    for art in todo:
        if art not in results:
            continue
        slug = in_map.get(art, "")
        p = results[art] or {}
        pip = str(p.get("pipUrl") or "")
        rec = {"id": art, "no": art.lstrip("s"), "type": "SPR" if art.startswith("s") else "ART",
               "name": p.get("name") or slug.rsplit("-", 1)[0].replace("-", " ").upper(), "kind": p.get("typeName", ""), "measure": "",
               "slug": pip[len(model.P_PREFIX):].rstrip("/") if pip.startswith(model.P_PREFIX) else slug, "cat": "",
               "img": (p.get("mainImage") or {}).get("url", "").replace(model.IMG_PREFIX, ""), "price": p.get("priceNumeral"), "prev": None,
               "vfrom": "", "vto": "", "tag": "", "last": 0, "online": 0, "col": "", "ctx": "", "rating": 0, "rcount": 0}
        if rec["price"] is None:
            db[art] = {**rec, "price": 0.0, "first_seen": day, "last_seen": day, "status": "stub", "missing": 0, "ph": [], "log": []}
        else:
            model.merge(db, [rec], day, complete=False)
            db[art]["status"] = "active"
        done += 1
    return done


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="nur die ersten N Kategorien (Probelauf)")
    ap.add_argument("--sitemap", action="store_true", help="Luecken gegen die Produkt-Sitemaps ermitteln")
    ap.add_argument("--fill", type=int, default=0, help="so viele Luecken-Artikel nachladen")
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)
    t0, ts = time.time(), now()
    day = ts[:10]
    db = store.load_db()
    before = len(db)
    meta = store.read_bin("meta.bin", {}) or {}
    keys = api.category_ids()
    if a.limit:
        keys = keys[: a.limit]
    print(f"[katalog] {len(keys)} Kategorien, bisher {before} Artikel")
    items, failed, blocked = collect(keys, a.workers)
    active_before = sum(1 for o in db.values() if o["status"] == "active")
    uniq = {i["id"] for i in items}
    complete = (not failed and not a.limit and not blocked and (active_before == 0 or len(uniq) >= MIN_SHARE * active_before))
    stats = model.merge(db, items, day, complete)
    if len(db) < before:
        raise SystemExit(f"Abbruch: Bestand waere von {before} auf {len(db)} geschrumpft.")
    gap = meta.get("gaps")
    in_map = None
    if a.sitemap and not blocked:
        in_map = sitemap_ids()
        store.write_bin("gaps.bin", {"day": day, "map": {i: u for i, u in in_map.items() if i not in db}})   # alle Luecken, fuer die taeglichen Nachlade-Laeufe
    elif a.fill and not blocked:
        saved = store.read_bin("gaps.bin", {}) or {}
        in_map = saved.get("map") or None
    if in_map is not None:
        gap = {**gaps(db, in_map), "day": day}
        if a.fill:
            todo = [i for i in sorted(in_map, key=lambda x: (x.startswith("s"), x)) if i not in db]
            try:
                gap["filled"] = fill(db, todo, in_map, day, a.fill, a.workers)
            except api.Blocked as ex:
                print(f"[katalog] Nachladen gesperrt: {ex}")
            gap = {**gaps(db, in_map), "day": day, "filled": gap.get("filled", 0)}
    version = store.save_db(db)
    run = {"ts": ts, "categories": len(keys), "failed": len(failed), "seen": len(uniq), "complete": int(complete),
           "total": len(db), "active": sum(1 for o in db.values() if o["status"] == "active"), **stats,
           "duration_s": round(time.time() - t0, 1)}
    runs = (meta.get("runs") or []) + [run]
    # Ende der Anlernphase: erster Tag, an dem keine Sitemap-Luecke mehr offen ist. Alles bis dahin gilt als Startbestand.
    baseline = meta.get("baseline_until") or (day if gap and gap.get("only_sitemap", 1) == 0 and complete else None)
    store.write_bin("meta.bin", {"updated": ts, "items_version": version, "last_run": run, "runs": runs, "gaps": gap, "schema": 1,
                                 **({"baseline_until": baseline} if baseline else {})})
    print(f"[katalog] fertig: {run}")
    if items and not blocked:                       # Folgen: neue, ausgelistete, im Preis geaenderte Artikel melden
        try:
            from tracker import subs
            subs.notify_catalog(db, day, baseline)
        except Exception as ex:
            print(f"[katalog] Folgen-Meldungen fehlgeschlagen: {ex}")
    return 2 if blocked and not items else 0


if __name__ == "__main__":
    sys.exit(main())
