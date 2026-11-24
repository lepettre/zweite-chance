"""Produktdetails (Designer, Beschreibung, Material, Masse, Bilder) aus den Produktseiten.

Aendern sich selten -> je Artikel einmal holen, danach nur noch selten auffrischen; pro Lauf ein Tageskontingent.
Ablage: k/details.bin (verschluesselt, gleiche Tabellenform wie die anderen Dateien).

  python -m katalog.details --limit 1500          # naechste 1500 Artikel ohne Details
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from . import api, model, store

FIELDS = ["designer", "desc", "material", "color", "w", "h", "d", "imgs", "day", "ok"]


def parse_page(html: str) -> dict:
    """Produktseite -> {designer, desc, material, color, w, h, d, imgs}. Fehlende Angaben bleiben leer."""
    out = {k: "" for k in FIELDS if k not in ("day", "ok")}
    for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', html, flags=re.S):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("@type") == "Product":
            out["desc"] = re.sub(r"\s+", " ", str(d.get("description") or "")).strip()
            out["material"] = str(d.get("material") or "")
            out["color"] = str(d.get("color") or "")
            for src, dst in (("width", "w"), ("height", "h"), ("depth", "d")):
                out[dst] = str(d.get(src) or "")
            imgs = d.get("image") or []
            imgs = [imgs] if isinstance(imgs, (str, dict)) else imgs
            urls = [i if isinstance(i, str) else (i or {}).get("contentUrl", "") for i in imgs]
            out["imgs"] = "|".join(u.replace(model.IMG_PREFIX, "").split("?")[0] for u in urls[:8] if u)
            break
    i = html.find('"designer":{')
    if i >= 0:
        try:
            obj, _ = json.JSONDecoder().raw_decode(html[i + len('"designer":'):])
            out["designer"] = str(obj.get("name") or "")
        except ValueError:
            pass
    return out


def pack(rows: dict) -> dict:
    table, ix = [""], {"": 0}
    out = []
    for k in sorted(rows):
        r = rows[k]
        row = [k]
        for f in FIELDS:
            v = str(r.get(f, ""))
            i = ix.get(v)
            if i is None:
                i = ix[v] = len(table)
                table.append(v)
            row.append(i)
        out.append(row)
    return {"f": ["id"] + FIELDS, "s": table, "r": out}


def unpack(d: dict | None) -> dict:
    if not d:
        return {}
    names, table = d["f"], d["s"]
    return {row[0]: {f: table[row[i + 1]] for i, f in enumerate(names[1:])} for row in d["r"]}


def facets(rows: dict) -> dict:
    by: dict[str, list[str]] = {}
    for k, r in sorted(rows.items()):
        if r.get("designer"):
            by.setdefault(r["designer"], []).append(k)
    mat: dict[str, list[str]] = {}
    for k, r in sorted(rows.items()):
        m = re.split(r"\s*[,(;/]\s*", r.get("material") or "")[0].strip()
        if m:
            mat.setdefault(m[:1].upper() + m[1:], []).append(k)
    mat = dict(sorted(mat.items(), key=lambda kv: -len(kv[1]))[:60])         # nur die haeufigsten Materialien
    return {"designer": by, "material": mat, "n": len(rows)}


def pick(db: dict, have: dict, limit: int, max_age_days: int, today: str) -> list[str]:
    """Erst Artikel ohne Details (neueste zuerst), dann die am laengsten nicht aufgefrischten."""
    todo = sorted((i for i, o in db.items() if o["status"] == "active" and o.get("slug") and i not in have), key=lambda i: db[i]["first_seen"], reverse=True)
    if len(todo) < limit:
        cutoff = (date.fromisoformat(today) - timedelta(days=max_age_days)).isoformat()
        old = sorted((i for i, r in have.items() if i in db and r.get("day", "") < cutoff), key=lambda i: have[i].get("day", ""))
        todo += old
    return todo[:limit]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=1500)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--max-age-days", type=int, default=180)
    ap.add_argument("--budget-min", type=int, default=75)
    a = ap.parse_args(argv)
    t0, today = time.time(), datetime.now(timezone.utc).date().isoformat()
    db = store.load_db()
    if not db:
        print("[details] Kein Katalog vorhanden.")
        return 1
    have = unpack(store.read_bin("details.bin"))
    todo = pick(db, have, a.limit, a.max_age_days, today)
    print(f"[details] {len(have)} vorhanden, {len(todo)} jetzt holen")
    lock, blocked, n_ok, n_fail = threading.Lock(), threading.Event(), [0], [0]

    def one(i: str) -> None:
        if blocked.is_set() or time.time() - t0 > a.budget_min * 60:
            return
        try:
            html = api.get(f"{api.BASE}/de/de/p/{db[i]['slug']}/", timeout=60).decode("utf-8", "replace")
            r = parse_page(html)
            with lock:
                have[i] = {**r, "day": today, "ok": "1"}
                n_ok[0] += 1
        except api.Blocked as ex:
            blocked.set()
            print(f"[details] GESPERRT: {ex}")
        except FileNotFoundError:
            with lock:                              # Seite gibt es nicht mehr: nicht ewig neu versuchen
                have[i] = {**{k: "" for k in FIELDS}, "day": today, "ok": ""}
                n_fail[0] += 1
        except Exception as ex:
            with lock:
                n_fail[0] += 1
            print(f"[details] {i}: {ex}")
        api.pause()

    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
        list(ex.map(one, todo))
    if blocked.is_set() and not n_ok[0]:
        return 2
    store.write_bin("details.bin", pack(have))
    store.write_bin("facets.bin", facets(have))          # klein: Designer -> Artikel (fuer Filter, ohne die langen Texte zu laden)
    print(f"[details] fertig: {n_ok[0]} geholt, {n_fail[0]} ohne Ergebnis, gesamt {len(have)}, {round(time.time() - t0)} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
