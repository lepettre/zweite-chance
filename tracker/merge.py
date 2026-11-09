"""Abgleich eines Abrufs mit dem Bestand.

Regeln (identisch im Browser-Modus, docs/app.js -> mergeSnapshot):
 * Schluessel = offerUuid (Fallback Markt+offerNumber). Gleiche Produkte = verschiedene Angebote.
 * Nur Maerkte, die VOLLSTAENDIG und plausibel abgerufen wurden, duerfen Angebote "verschwinden" lassen.
 * Ein Angebot gilt als 'gone', wenn es in GONE_AFTER aufeinanderfolgenden erfolgreichen
   Abrufen seines Markts fehlt. gone_at = letzter Zeitpunkt, an dem es gesehen wurde.
 * Taucht es wieder auf -> derselbe Datensatz wird reaktiviert (Ereignis 'reappeared').
 * Preis- und Textaenderungen -> Ereignisse 'price_change' / 'changed'; price_history wird gefuehrt.
 * Datumsfelder sind Beobachtungen dieses Trackers (die API liefert kein Einstelldatum).
"""
from __future__ import annotations

from .normalize import content_hash

GONE_AFTER = 2
LOGGED = {"gone": "gone", "reappeared": "back", "changed": "chg"}
# Leerer Markt trotz grossem Bestand => vermutlich Stoerung, nicht "alles verkauft"
SUSPICIOUS_EMPTY_MIN = 10


def plausible(store_id: str, n_seen: int, db: dict) -> bool:
    if n_seen > 0:
        return True
    active = sum(1 for o in db.values() if o["store_id"] == store_id and o["status"] == "active")
    return active < SUSPICIOUS_EMPTY_MIN


def merge(db: dict, records: list[dict], ok_stores: set[str], ts: str) -> list[dict]:
    """db: id -> Angebot (wird veraendert). Rueckgabe: Liste neuer Ereignisse."""
    events: list[dict] = []
    seen_ids = set()

    def ev(o, typ, **kw):
        if typ in LOGGED:                       # dauerhaft am Angebot: verschwunden / wieder da / Angaben geaendert
            o.setdefault("log", []).append([ts, LOGGED[typ]] + ([kw["fields"]] if kw.get("fields") else []))
        events.append({"ts": ts, "type": typ, "id": o["id"], "store_id": o["store_id"],
                       "article_number": o.get("article_number", ""), "title": o.get("title", ""),
                       "price": o.get("price"), **kw})

    for r in records:
        if r["id"] in seen_ids:      # doppelt in derselben Antwort -> ignorieren
            continue
        seen_ids.add(r["id"])
        h = content_hash(r)
        o = db.get(r["id"])
        if o is None:
            o = {**r, "first_seen": ts, "last_seen": ts, "gone_at": None, "status": "active",
                 "missing_runs": 0, "reappear_count": 0, "hash": h,
                 "price_history": [[ts, r["price"]]]}
            db[r["id"]] = o
            ev(o, "new")
            continue
        if o["status"] == "gone":
            o["status"] = "active"
            o["gone_at"] = None
            o["reappear_count"] = o.get("reappear_count", 0) + 1
            ev(o, "reappeared")
        if r["price"] != o.get("price"):
            ev(o, "price_change", old_price=o.get("price"), new_price=r["price"])
            o.setdefault("price_history", []).append([ts, r["price"]])
        if h != o.get("hash"):
            changed = [k for k in ("title", "condition", "condition_description", "reason_discount",
                                   "additional_info", "offer_description", "original_price")
                       if str(r.get(k, "")) != str(o.get(k, ""))]
            if changed:
                ev(o, "changed", fields=",".join(changed))
        keep = {k: o.get(k) for k in ("first_seen", "gone_at", "status", "reappear_count", "price_history", "log")}
        keep["log"] = keep["log"] or []
        keep["reappear_count"] = keep["reappear_count"] or 0
        keep["price_history"] = keep["price_history"] or [[o["first_seen"], o.get("price")]]
        o.clear()
        o.update(r)
        o.update(keep)
        o["hash"] = h
        o["last_seen"] = ts
        o["missing_runs"] = 0

    for o in db.values():
        if o["status"] != "active" or o["id"] in seen_ids or o["store_id"] not in ok_stores:
            continue
        o["missing_runs"] = o.get("missing_runs", 0) + 1
        if o["missing_runs"] >= GONE_AFTER:
            o["status"] = "gone"
            o["gone_at"] = o["last_seen"]
            ev(o, "gone")
    return events
