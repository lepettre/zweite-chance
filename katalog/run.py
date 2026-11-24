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


def fill(db: dict, ids: list[str], in_map: dict[str, str], day: str, limit: int) -> int:
    """Luecken-Artikel (nur in der Sitemap) ueber ihre Produkt-JSON nachladen. Sets (s...) bleiben Platzhalter."""
    done = 0
    for art in ids:
        if done >= limit:
            break
        if art in db:
            continue
        slug = in_map.get(art, "")
        rec = {"id": art, "no": art.lstrip("s"), "type": "SPR" if art.startswith("s") else "ART", "name": slug.rsplit("-", 1)[0].replace("-", " ").upper(),
               "kind": "", "measure": "", "slug": slug, "img": "", "cat": "", "price": None, "prev": None, "vfrom": "", "vto": "", "tag": "", "last": 0, "online": 0}
        if not art.startswith("s"):
            try:
                p = api.fetch_product_json(art)
                rec.update(name=p.get("name") or rec["name"], kind=p.get("typeName", ""), price=p.get("priceNumeral"),
                           img=(p.get("mainImage") or {}).get("url", "").replace(model.IMG_PREFIX, ""))
            except api.Blocked:
                raise
            except Exception:
                pass
            api.pause()
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
    if a.sitemap and not blocked:
        in_map = sitemap_ids()
        gap = {**gaps(db, in_map), "day": day}
        if a.fill:
            gap["filled"] = fill(db, gap["only_sitemap_ids"], in_map, day, a.fill)
            gap = {**gaps(db, in_map), "day": day, "filled": gap["filled"]}
    version = store.save_db(db)
    run = {"ts": ts, "categories": len(keys), "failed": len(failed), "seen": len(uniq), "complete": int(complete),
           "total": len(db), "active": sum(1 for o in db.values() if o["status"] == "active"), **stats,
           "duration_s": round(time.time() - t0, 1)}
    runs = (meta.get("runs") or []) + [run]
    store.write_bin("meta.bin", {"updated": ts, "items_version": version, "last_run": run, "runs": runs, "gaps": gap, "schema": 1})
    print(f"[katalog] fertig: {run}")
    return 2 if blocked and not items else 0


if __name__ == "__main__":
    sys.exit(main())
