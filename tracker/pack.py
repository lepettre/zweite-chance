"""Kompaktes Tabellenformat fuer Angebote (Zeilen + gemeinsame Zeichenketten-Tabelle).

Abgeleitete Felder (Link, Rabatt, Marktname, Hash ...) werden nicht gespeichert, sondern beim
Laden berechnet - in Python (hier) und im Browser (docs/core.js: unpackOffers).
"""
from __future__ import annotations

import json

from .normalize import content_hash, offer_link, store_slug

STR_FIELDS = ["id", "offer_number", "store_id", "title", "product_description", "offer_description",
              "article_numbers", "condition", "condition_code", "condition_description",
              "reason_discount", "additional_info", "image", "status", "first_seen", "last_seen",
              "gone_at", "price_history", "log"]
NUM_FIELDS = ["price", "original_price", "reappear_count", "missing_runs"]
FIELDS = STR_FIELDS + NUM_FIELDS


def pack_offers(offers: list[dict]) -> dict:
    table, index = [""], {"": 0}

    def sid(s: str) -> int:
        i = index.get(s)
        if i is None:
            i = index[s] = len(table)
            table.append(s)
        return i

    rows = []
    for o in sorted(offers, key=lambda x: x["id"]):
        row = []
        for f in STR_FIELDS:
            if f == "article_numbers":
                v = ",".join(o.get("article_numbers") or ([o["article_number"]] if o.get("article_number") else []))
            elif f == "price_history":
                ph = o.get("price_history") or []
                standard = len(ph) == 1 and ph[0][0] == o.get("first_seen") and ph[0][1] == o.get("price")
                v = "" if standard else json.dumps(ph, separators=(",", ":"))   # Standard: wird beim Laden ergaenzt
            elif f == "log":
                v = json.dumps(o["log"], ensure_ascii=False, separators=(",", ":")) if o.get("log") else ""
            elif f == "last_seen":
                v = o.get("last_seen") or ""
                if o.get("status") == "active" and not o.get("missing_runs"):
                    v = ""                      # entspricht dem letzten Abruf des Markts
            else:
                v = o.get(f)
            row.append(sid("" if v is None else str(v)))
        row.extend(o.get(f) for f in NUM_FIELDS)
        rows.append(row)
    return {"f": FIELDS, "s": table, "r": rows}


def unpack_offers(d: dict | None, stores: dict, last_ok: dict | None = None, updated: str | None = None) -> list[dict]:
    if not d:
        return []
    names, table = d["f"], d["s"]
    out = []
    for row in d["r"]:
        r = dict(zip(names, row))
        o = {f: table[r[f]] for f in STR_FIELDS}
        for f in NUM_FIELDS:
            o[f] = r[f]
        arts = [a for a in o.pop("article_numbers").split(",") if a]
        sid = o["store_id"]
        st = stores.get(sid, {})
        price, orig = o["price"], o["original_price"]
        disc = round(orig - price, 2) if orig is not None and price is not None else None
        o.update({
            "article_numbers": arts, "article_number": arts[0] if arts else "",
            "offer_uuid": o["id"][2:] if o["id"].startswith("u:") else "",
            "store": st.get("name", sid), "currency": "EUR",
            "discount_eur": disc, "discount_pct": round(disc / orig * 100, 1) if disc is not None and orig else None,
            "link": offer_link(st.get("slug") or store_slug(st.get("name", sid)), o["offer_number"]),
            "gone_at": o["gone_at"] or None,
            "price_history": json.loads(o["price_history"]) if o["price_history"] else [[o["first_seen"], price]],
            "log": json.loads(o["log"]) if o["log"] else [],
        })
        o["hash"] = content_hash(o)
        if not o["last_seen"]:
            o["last_seen"] = (last_ok or {}).get(sid) or updated or o["first_seen"]
        out.append(o)
    return out
