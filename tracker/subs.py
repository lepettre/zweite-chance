"""Folgen: Designer, Serien und Kollektionen.

Eine Merklisten-Regel mit Feld "sub" = {"k": "des" | "serie" | "koll", "v": Name, "raw": [IKEA-Designerangaben]}
meldet (a) Fundgrube-Angebote dieser Artikel in den Maerkten der Regel (Feld "stores") und
(b) einmal taeglich nach dem Sortimentslauf: neue, ausgelistete und im Preis geaenderte Artikel.
"""
from __future__ import annotations

import html
import os

_CAT: dict | None = None


def _load_catalog() -> dict:
    """Sortiment und Designer-Zuordnung aus site/k (verschluesselt). Fehlt etwas, bleibt die Zuordnung leer."""
    global _CAT
    if _CAT is not None:
        return _CAT
    try:
        from katalog import store
        db = store.load_db()
        facets = store.read_bin("facets.bin", {}) or {}
    except Exception as ex:                                  # ohne Sortiment keine Zuordnung, aber kein Abbruch
        print(f"[subs] Sortiment nicht lesbar: {ex}")
        db, facets = {}, {}
    by_no = {o["no"]: o for o in db.values() if o.get("status") != "stub"}
    _CAT = {"db": db, "by_no": by_no, "designer": {k: set(v) for k, v in (facets.get("designer") or {}).items()}}
    return _CAT


def item_matches(sub: dict, item: dict, designer: dict) -> bool:
    k, v = sub.get("k"), sub.get("v", "")
    if k in ("serie", "koll"):
        return item.get("name") == v
    if k == "des":
        return any(item["id"] in designer.get(raw, ()) for raw in sub.get("raw") or [v])
    return False


def offer_matches(rule: dict, o: dict) -> bool:
    """Fundgrube-Angebot gehoert zu einem gefolgten Designer/Serie/Kollektion (und liegt in einem der Maerkte)."""
    stores = [str(s) for s in rule.get("stores") or []]
    if stores and str(o.get("store_id")) not in stores:
        return False
    cat = _load_catalog()
    nos = o.get("article_numbers") or [o.get("article_number", "")]
    return any(item_matches(rule["sub"], cat["by_no"][n], cat["designer"]) for n in nos if n in cat["by_no"])


def label(rule: dict) -> str:
    s = rule.get("sub") or {}
    return {"des": "Designer", "serie": "Serie", "koll": "Kollektion"}.get(s.get("k"), "") + " " + s.get("v", "")


def catalog_events(db: dict, day: str) -> list[tuple[str, dict]]:
    """Ereignisse dieses Sortimentslaufs: neu, ausgelistet, Preis gesenkt/erhoeht."""
    first = min((o["first_seen"] for o in db.values()), default=day)
    ev = []
    for o in db.values():
        if o.get("status") == "stub":
            continue
        if o["first_seen"] == day and day > first:
            ev.append(("neu", o))
        if [day, "gone"] in (o.get("log") or []):
            ev.append(("ausgelistet", o))
        ph = o.get("ph") or []
        if len(ph) > 1 and ph[-1][0] == day and ph[-1][1] is not None and ph[-2][1] is not None:
            ev.append(("Preis gesenkt" if ph[-1][1] < ph[-2][1] else "Preis erhöht", o))
    return ev


def _eur(v) -> str:
    return "–" if v is None else f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def catalog_messages(rules: list[dict], db: dict, day: str, designer: dict, sent_keys: dict) -> list[str]:
    subs = [r for r in rules if r.get("sub") and r.get("enabled") is not False and r.get("notify") is not False]
    if not subs:
        return []
    ev, msgs = catalog_events(db, day), []
    for r in subs:
        lines = []
        for kind, o in ev:
            if not item_matches(r["sub"], o, designer):
                continue
            key = f"{r.get('id')}|{o['id']}|{kind}|{day}"
            if key in sent_keys:
                continue
            sent_keys[key] = day
            ph = o.get("ph") or []
            price = f"{_eur(ph[-2][1])} → {_eur(o.get('price'))}" if kind.startswith("Preis") and len(ph) > 1 else _eur(o.get("price"))
            url = f"https://www.ikea.com/de/de/p/{o.get('slug')}/" if o.get("slug") else "https://www.ikea.com/de/de/"
            lines.append(f"{kind}: <a href=\"{html.escape(url)}\">{html.escape(o.get('name', ''))} {html.escape(o.get('kind', ''))}</a> · {price}")
        if lines:
            more = f"\n… und {len(lines) - 15} weitere" if len(lines) > 15 else ""
            msgs.append(f"<b>Folgen: {html.escape(label(r).strip())}</b>\n" + "\n".join(lines[:15]) + more)
    return msgs


def notify_catalog(db: dict, day: str) -> int:
    """Nach dem taeglichen Sortimentslauf: Meldungen fuer gefolgte Designer/Serien/Kollektionen senden."""
    from katalog import store
    from . import watch
    try:
        rules, _, _ = watch.load_watchlist()
    except Exception as ex:
        print(f"[subs] Merkliste nicht lesbar: {ex}")
        return 0
    facets = store.read_bin("facets.bin", {}) or {}
    designer = {k: set(v) for k, v in (facets.get("designer") or {}).items()}
    log = store.read_bin("subsent.bin", {}) or {}
    keys = log.setdefault("keys", {})
    msgs = catalog_messages(rules, db, day, designer, keys)
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    sent = 0
    for m in msgs:
        if not (token and chat):
            break
        try:
            watch.send_telegram(m, token, chat)
            sent += 1
            log.setdefault("sent", []).append({"ts": day, "text": m})     # Protokoll, wird nie gekuerzt
        except Exception as ex:
            print(f"[subs] Telegram-Fehler: {ex}")
    store.write_bin("subsent.bin", log)
    print(f"[subs] {len(msgs)} Meldungen, {sent} gesendet")
    return sent
