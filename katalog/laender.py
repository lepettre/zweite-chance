"""Laendervergleich: dieselben IKEA-Listen in anderen Laendern, woechentlich je Land.

Je Land eine eigene Datei k/intl-<land>.bin (gleiches Format wie das deutsche Sortiment, mit Preisverlauf,
nichts wird geloescht). Daraus entsteht k/intl.bin: Preis je Land fuer jeden Artikel plus Wechselkurse,
klein genug fuer die Web-App.

  python -m katalog.laender                  # faellige Laender (aelter als 6 Tage), in Prioritaetsreihenfolge
  python -m katalog.laender --only dk,pl     # nur diese
"""
from __future__ import annotations

import argparse
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from . import api, model, store

# Reihenfolge = Prioritaet: erst Nachbarn mit eigenem Profil, dann uebriges Europa, dann grosse Maerkte
COUNTRIES = [
    ("dk", "da"), ("pl", "pl"), ("se", "sv"), ("fi", "fi"), ("nl", "nl"),
    ("at", "de"), ("be", "nl"), ("fr", "fr"), ("ch", "de"), ("it", "it"), ("es", "es"), ("no", "no"), ("pt", "pt"),
    ("cz", "cs"), ("sk", "sk"), ("hu", "hu"), ("ro", "ro"), ("hr", "hr"), ("si", "sl"), ("rs", "sr"),
    ("ee", "et"), ("lv", "lv"), ("lt", "lt"), ("ie", "en"), ("gb", "en"),
    ("us", "en"), ("jp", "ja"), ("kr", "ko"), ("au", "en"), ("ca", "en"), ("in", "en"), ("mx", "es"),
    ("sa", "en"), ("ae", "en"), ("il", "he"), ("th", "th"), ("sg", "en"), ("my", "en"), ("ph", "en"),
    ("nz", "en"), ("cl", "es"), ("co", "es"),
]
ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
DUE_DAYS = 6


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def category_ids(cc: str, lang: str) -> list[str]:
    index = api.get(f"{api.BASE}/sitemaps/sitemap.xml").decode("utf-8", "replace")
    maps = sorted(set(re.findall(rf"<loc>(https://www\.ikea\.com/sitemaps/cat-{lang}-{cc.upper()}_\d+\.xml)</loc>", index)))
    ids: list[str] = []
    for m in maps:
        text = api.get(m, timeout=120).decode("utf-8", "replace")
        ids += re.findall(rf"/{cc}/{lang}/cat/[^<]*?-([0-9a-z]+)/</loc>", text)
        api.pause()
    return sorted(set(ids))


def fetch_category(cc: str, lang: str, key: str) -> dict:
    return api.get_json(f"https://sik.search.blue.cdtapps.com/{cc}/{lang}/product-list-page?category={key}&size=1000")["productListPage"]


def parse(it: dict, cc: str, lang: str) -> dict | None:
    r = model.parse_item(it)
    if not r:
        return None
    pip, img = str(it.get("pipUrl") or ""), str(it.get("mainImageUrl") or "")
    r["slug"] = pip                                   # volle Adresse im jeweiligen Land
    r["img"] = img.split("?")[0]
    r["cur"] = (it.get("salesPrice") or {}).get("currencyCode", "")
    return r


def measure_country(cc: str, lang: str, workers: int = 3, budget_s: float = 1e9) -> tuple[list[dict], int, bool]:
    keys = category_ids(cc, lang)
    items, failed, blocked, lock, t0 = [], [0], threading.Event(), threading.Lock(), time.time()

    def one(key: str) -> None:
        if blocked.is_set() or time.time() - t0 > budget_s:
            return
        try:
            page = fetch_category(cc, lang, key)
            got = [x for x in (parse(i, cc, lang) for i in page.get("productWindow") or []) if x]
            with lock:
                items.extend(got)
        except api.Blocked:
            blocked.set()
        except FileNotFoundError:
            pass
        except Exception:
            with lock:
                failed[0] += 1
        api.pause()

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(one, keys))
    complete = not blocked.is_set() and failed[0] <= max(3, len(keys) // 50) and time.time() - t0 <= budget_s
    return items, len(keys), complete


def ecb_rates() -> dict[str, float]:
    """Euro-Referenzkurse der EZB: 1 EUR = x Waehrung."""
    xml = api.get(ECB, retries=2).decode("utf-8", "replace")
    return {c: float(r) for c, r in re.findall(r"currency='([A-Z]{3})' rate='([0-9.]+)'", xml)}


def build_matrix(index: dict, de_db: dict) -> dict:
    """Preis je Land und Artikel (nur aktuelle Artikel) plus Angaben zu Artikeln, die es in Deutschland nicht gibt."""
    countries = [c for c, _ in COUNTRIES if c in index.get("countries", {})]
    dbs = {c: model.unpack(store.read_bin(f"intl-{c}.bin")) for c in countries}
    ids = sorted({i for db in dbs.values() for i, o in db.items() if o["status"] == "active"})
    pos = {i: n for n, i in enumerate(ids)}
    prices = {}
    for c, db in dbs.items():
        col = [None] * len(ids)
        for i, o in db.items():
            if o["status"] == "active" and i in pos:
                col[pos[i]] = o["price"]
        prices[c] = col
    foreign = {}
    for i in ids:
        if i in de_db and de_db[i].get("status") != "stub":
            continue
        for c in countries:
            o = dbs[c].get(i)
            if o and o["status"] == "active":
                foreign[i] = [o.get("name", ""), o.get("kind", ""), o.get("img", ""), c, o.get("slug", ""), o.get("cat", "")]
                break
    return {"updated": now(), "countries": [{"cc": c, **index["countries"][c]} for c in countries], "rates": index.get("rates", {}),
            "ids": ids, "p": prices, "x": foreign}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="Laenderkuerzel, kommagetrennt")
    ap.add_argument("--budget-min", type=int, default=100)
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)
    t0 = time.time()
    index = store.read_bin("intl-index.bin", {}) or {}
    index.setdefault("countries", {})
    try:
        rates = ecb_rates()
        if rates:
            index["rates"] = {**rates, "_day": now()[:10]}
    except Exception as ex:
        print(f"[laender] Wechselkurse nicht abrufbar ({ex}) - nutze die letzten bekannten.")
    want = [x.strip() for x in a.only.split(",") if x.strip()]
    cutoff = (datetime.now(timezone.utc) - timedelta(days=DUE_DAYS)).isoformat()
    todo = [(c, l) for c, l in COUNTRIES if (c in want if want else (index["countries"].get(c, {}).get("updated", "") < cutoff))]
    done = []
    for cc, lang in todo:
        left = a.budget_min * 60 - (time.time() - t0)
        if left < 300:
            break
        try:
            items, n_keys, complete = measure_country(cc, lang, a.workers, left - 60)
        except api.Blocked as ex:
            print(f"[laender] {cc}: GESPERRT ({ex}) - Abbruch.")
            break
        except Exception as ex:
            print(f"[laender] {cc}: {ex}")
            continue
        if not items:
            print(f"[laender] {cc}: keine Artikel")
            continue
        db = model.unpack(store.read_bin(f"intl-{cc}.bin"))
        before = len(db)
        stats = model.merge(db, items, now()[:10], complete)
        if len(db) < before:
            raise SystemExit(f"Abbruch: {cc} wuerde schrumpfen")
        store.write_bin(f"intl-{cc}.bin", model.pack(db))
        cur = next((i["cur"] for i in items if i.get("cur")), "")
        index["countries"][cc] = {"lang": lang, "cur": cur, "updated": now(), "categories": n_keys, "complete": int(complete),
                                  "active": sum(1 for o in db.values() if o["status"] == "active"), **stats}
        done.append(cc)
        print(f"[laender] {cc}: {index['countries'][cc]['active']} Artikel ({cur}), {stats}")
    store.write_bin("intl-index.bin", index)
    store.write_bin("intl.bin", build_matrix(index, store.load_db()))
    print(f"[laender] fertig: {', '.join(done) or 'nichts faellig'} in {round(time.time() - t0)} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
