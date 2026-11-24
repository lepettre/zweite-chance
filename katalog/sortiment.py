"""Sortiment je Markt: welcher Artikel ist in welchem der 55 deutschen Maerkte im Sortiment ("inRange")?

Speicher: k/range.bin = {ids (nur anhaengen), stores [...], range {markt: Bitfeld}, stock {markt: Bitfeld}}.
Je Markt zaehlt n = so viele Artikel (am Listenanfang) wurden gemessen; spaeter hinzugekommene Artikel sind "unbekannt".

  python -m katalog.sortiment                 # alle Maerkte (ca. 45-60 Min.)
  python -m katalog.sortiment --stores 8      # nur die 8 am laengsten nicht gemessenen Maerkte
"""
from __future__ import annotations

import argparse
import base64
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import api, store


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def key_of(a: dict) -> str:
    k = a.get("itemKey") or {}
    return ("s" if k.get("itemType") == "SPR" else "") + str(k.get("itemNo", ""))


def parse_availability(a: dict) -> tuple[bool, bool]:
    cc = (a.get("buyingOption") or {}).get("cashCarry") or {}
    in_range = bool((cc.get("range") or {}).get("inRange"))
    qty = ((cc.get("availability") or {}).get("quantity")) or 0
    return in_range, qty > 0


def to_bits(flags: list[bool]) -> str:
    b = bytearray((len(flags) + 7) // 8)
    for i, f in enumerate(flags):
        if f:
            b[i >> 3] |= 1 << (i & 7)
    return base64.b64encode(bytes(b)).decode()


def from_bits(s: str, n: int) -> list[bool]:
    raw = base64.b64decode(s) if s else b""
    return [bool(raw[i >> 3] >> (i & 7) & 1) if (i >> 3) < len(raw) else False for i in range(n)]


def sweep_store(store_id: str, ids: list[str], chunk: int = api.AVAIL_MAX) -> tuple[list[bool], list[bool], int]:
    """-> (inRange, inStock, Anzahl ohne Antwort). Reihenfolge wie ids."""
    pos = {k: i for i, k in enumerate(ids)}
    rng, stk, answered = [False] * len(ids), [False] * len(ids), 0
    for i in range(0, len(ids), chunk):
        part = ids[i:i + chunk]
        for a in api.availabilities(store_id, [x.lstrip("s") for x in part]):
            j = pos.get(key_of(a))
            if j is not None:
                rng[j], stk[j] = parse_availability(a)
                answered += 1
        api.pause()
    return rng, stk, len(ids) - answered


def update_ids(prev: list[str], db: dict) -> list[str]:
    """Nur anhaengen, nie umsortieren oder entfernen (Bitfelder verweisen auf die Position)."""
    have = set(prev)
    new = sorted(i for i, o in db.items() if o["status"] == "active" and i not in have)
    return prev + new


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stores", type=int, default=0, help="nur so viele Maerkte (aelteste Messung zuerst); 0 = alle")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--budget-min", type=int, default=130, help="danach keine neuen Maerkte mehr beginnen")
    a = ap.parse_args(argv)
    t0, ts = time.time(), now()
    db = store.load_db()
    if not db:
        print("[sortiment] Kein Katalog vorhanden - erst den Katalog-Lauf ausfuehren.")
        return 1
    cur = store.read_bin("range.bin", {}) or {}
    ids = update_ids(cur.get("ids", []), db)
    stores = {s["id"]: s for s in cur.get("stores", [])}
    for s in api.stores():
        stores[s["id"]] = {**stores.get(s["id"], {}), **s}
    order = sorted(stores, key=lambda k: stores[k].get("day", ""))
    todo = order[: a.stores] if a.stores else order
    rng, stk = dict(cur.get("range", {})), dict(cur.get("stock", {}))
    failed, blocked, lock = [], threading.Event(), threading.Lock()
    print(f"[sortiment] {len(ids)} Artikel x {len(todo)} Maerkte")

    def one(sid: str) -> None:
        if blocked.is_set() or time.time() - t0 > a.budget_min * 60:
            return
        try:
            r, s, missing = sweep_store(sid, ids)
            with lock:
                rng[sid], stk[sid] = to_bits(r), to_bits(s)
                stores[sid].update(day=ts[:10], n=len(ids), missing=missing, in_range=sum(r), in_stock=sum(s))
            print(f"[sortiment] {stores[sid]['name']:<24} {sum(r):>6} im Sortiment, {sum(s):>6} vorraetig, {missing} ohne Antwort")
        except api.Blocked as ex:
            blocked.set()
            print(f"[sortiment] GESPERRT: {ex}")
        except Exception as ex:
            with lock:
                failed.append(sid)
            print(f"[sortiment] Markt {sid}: {ex}")

    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
        list(ex.map(one, todo))
    done = [s for s in todo if stores[s].get("day") == ts[:10]]
    if not done and blocked.is_set():
        return 2
    store.write_bin("range.bin", {"v": 1, "updated": ts, "ids": ids, "stores": [stores[k] for k in sorted(stores)], "range": rng, "stock": stk})
    print(f"[sortiment] fertig: {len(done)} Maerkte gemessen, {len(failed)} fehlgeschlagen, {round(time.time() - t0)} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
