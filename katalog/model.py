"""Katalog-Datensaetze: aus Listenantworten lesen, zusammenfuehren (Preisverlauf, Sortimentsstatus), packen.

Grundsatz wie im Rest des Projekts: nichts wird geloescht. Ausgelistete Artikel bleiben mit Verlauf erhalten.
"""
from __future__ import annotations

import json

GONE_AFTER = 3          # so viele VOLLSTAENDIGE Laeufe ohne den Artikel -> "gone"
IMG_PREFIX = "https://www.ikea.com/de/de/images/products/"
P_PREFIX = "https://www.ikea.com/de/de/p/"


def _money(part: dict | None):
    """{'wholeNumber': '1.110', 'decimals': '00'} -> 1110.0"""
    if not part:
        return None
    whole = "".join(c for c in str(part.get("wholeNumber", "")) if c.isdigit())
    dec = "".join(c for c in str(part.get("decimals", "")) if c.isdigit()) or "0"
    return float(f"{whole}.{dec}") if whole else None


def _cat(item: dict) -> str:
    return " › ".join(c.get("name", "") for c in (item.get("categoryPath") or []) if c.get("name"))


def item_id(item_no: str, item_type: str) -> str:
    return ("s" if item_type == "SPR" else "") + str(item_no)


def parse_item(it: dict) -> dict | None:
    """Ein Eintrag der Listenantwort (productWindow) -> Katalogsatz (ohne Verlaufsfelder)."""
    no = str(it.get("itemNo") or it.get("itemNoGlobal") or "")
    if not no.isdigit():
        return None
    sp = it.get("salesPrice") or {}
    price = sp.get("numeral")
    if price is None:
        return None
    pip = str(it.get("pipUrl") or "")
    return {
        "id": item_id(no, it.get("itemType", "ART")), "no": no, "type": it.get("itemType", "ART"),
        "name": it.get("name", ""), "kind": it.get("typeName", ""), "measure": it.get("itemMeasureReferenceText", ""),
        "slug": pip[len(P_PREFIX):].rstrip("/") if pip.startswith(P_PREFIX) else "",
        "img": (it.get("mainImageUrl") or "").replace(IMG_PREFIX, ""), "cat": _cat(it),
        "price": float(price), "prev": _money(sp.get("previous")),
        "vfrom": sp.get("validFrom", ""), "vto": sp.get("validTo", ""), "tag": sp.get("tag", "NONE") if sp.get("tag") != "NONE" else "",
        "last": 1 if it.get("lastChance") else 0, "online": 1 if it.get("onlineSellable") else 0,
        "col": ", ".join(c.get("name", "") for c in (it.get("colors") or []) if c.get("name")),
        "ctx": (it.get("contextualImageUrl") or "").replace(IMG_PREFIX, ""),
        "rating": it.get("ratingValue") or 0, "rcount": it.get("ratingCount") or 0,
        # IKEA-eigene Gliederung und alle Varianten des Produkts (auch solche, die in keiner Liste stehen)
        "hfb": (it.get("businessStructure") or {}).get("homeFurnishingBusinessName", ""),
        "pa": (it.get("businessStructure") or {}).get("productAreaName", ""),
        "nvar": int((it.get("gprDescription") or {}).get("numberOfVariants") or 0),
        "vars": ",".join(str(v.get("id")) for v in ((it.get("gprDescription") or {}).get("variants") or []) if v.get("id")),
    }


def merge(db: dict, items: list[dict], day: str, complete: bool) -> dict:
    """items = parse_item-Ergebnisse dieses Laufs. Rueckgabe: Zaehler. db wird veraendert, nie verkleinert."""
    seen, stats = set(), {"new": 0, "price_change": 0, "gone": 0, "back": 0, "last_chance": 0}
    for r in items:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        o = db.get(r["id"])
        if o is None:
            db[r["id"]] = {**r, "first_seen": day, "last_seen": day, "status": "active", "missing": 0,
                           "ph": [[day, r["price"]]], "log": []}
            stats["new"] += 1
            continue
        if o["status"] == "gone":
            o["status"] = "active"
            o["log"].append([day, "back"])
            stats["back"] += 1
        if o["price"] != r["price"]:
            o["ph"].append([day, r["price"]])
            stats["price_change"] += 1
        if r["last"] and not o.get("last"):
            o["log"].append([day, "last"])
            stats["last_chance"] += 1
        o.update({k: r[k] for k in r if k not in ("id",) and (r[k] not in ("", None) or k in ("prev", "tag", "vfrom", "vto", "last", "online", "col", "ctx", "rating", "rcount", "nvar"))})
        o["last_seen"], o["missing"] = day, 0
    if complete:
        for o in db.values():
            if o["status"] != "active" or o["id"] in seen:
                continue
            o["missing"] += 1
            if o["missing"] >= GONE_AFTER:
                o["status"] = "gone"
                o["log"].append([day, "gone"])
                stats["gone"] += 1
    return stats


# ---- kompaktes Speicherformat (Zeilen + gemeinsame Zeichenketten-Tabelle), im Browser: docs/app.js (unpackK) ----
STR = ["id", "no", "type", "name", "kind", "measure", "slug", "img", "cat", "vfrom", "vto", "tag",
       "first_seen", "last_seen", "status", "ph", "log", "col", "ctx", "hfb", "pa", "vars"]
NUM = ["price", "prev", "last", "online", "missing", "rating", "rcount", "nvar"]


def pack(db: dict) -> dict:
    table, ix = [""], {"": 0}

    def sid(s) -> int:
        s = "" if s is None else str(s)
        i = ix.get(s)
        if i is None:
            i = ix[s] = len(table)
            table.append(s)
        return i

    rows = []
    for o in sorted(db.values(), key=lambda x: x["id"]):
        row = []
        for f in STR:
            if f == "ph":
                std = len(o["ph"]) == 1 and o["ph"][0] == [o["first_seen"], o["price"]]
                v = "" if std else json.dumps(o["ph"], separators=(",", ":"))
            elif f == "log":
                v = json.dumps(o["log"], separators=(",", ":")) if o["log"] else ""
            else:
                v = o.get(f)
            row.append(sid(v))
        row.extend(o.get(f) for f in NUM)
        rows.append(row)
    return {"f": STR + NUM, "s": table, "r": rows}


def unpack(d: dict | None) -> dict:
    if not d:
        return {}
    names, table, out = d["f"], d["s"], {}
    for row in d["r"]:
        r = dict(zip(names, row))                      # aeltere Dateien kennen neuere Spalten noch nicht
        o = {f: table[r[f]] if f in r else "" for f in STR}
        for f in NUM:
            o[f] = r.get(f, 0 if f in ("rating", "rcount", "nvar") else None)
        o["ph"] = json.loads(o["ph"]) if o["ph"] else [[o["first_seen"], o["price"]]]
        o["log"] = json.loads(o["log"]) if o["log"] else []
        out[o["id"]] = o
    return out
