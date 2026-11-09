"""Telegram-Abfrage: "Knivshult Hamburg" -> was gibt es gerade? Laeuft als eigener Workflow (bot.yml).

  python -m tracker.bot "Knivshult hamburg"      # Antwort geht per Telegram an TELEGRAM_CHAT_ID
  python -m tracker.bot --dry "neu kiel"         # nur ausgeben
"""
from __future__ import annotations

import argparse
import html
import os
import re
import sys
from datetime import datetime, timedelta, timezone

from . import storage, watch
from .normalize import fold, fmt_article, norm_article

STOP = {"in", "im", "bei", "und", "oder", "den", "die", "das", "der", "ein", "eine", "es", "gibt", "was", "wo",
        "aktuell", "gerade", "auf", "vorrat", "lager", "zeig", "zeige", "mir", "alle", "suche", "such", "nach",
        "ikea", "markt", "maerkte", "von", "für", "fuer", "mit", "ab", "noch"}
HELP = ("<b>Fragen</b>\n"
        "• <code>Knivshult Hamburg</code> – Produkt (und Markt) suchen\n"
        "• <code>neu</code> / <code>neu Kiel</code> – neu in den letzten 24 Std.\n"
        "• <code>stand</code> – wie aktuell sind die Daten\n"
        "<b>Merkliste</b>\n"
        "• <code>/liste</code> – Regeln anzeigen\n"
        "• <code>/merke Knivshult Hamburg</code> – Regel anlegen\n"
        "• <code>/vergiss 3</code> – Regel löschen")


def text_rest(text: str) -> str:
    return re.sub(r"^/?\w+\s*", "", (text or "").strip(), count=1)


def _eur(v):
    return watch._fmt_eur(v)


def parse(text: str, stores: list[dict]) -> tuple[str, list[str], set[str]]:
    """-> (Befehl, Suchbegriffe, Markt-IDs). Befehl: suche | neu | stand | hilfe"""
    t = (text or "").strip()
    cmd = "suche"
    m = re.match(r"^/?(\w+)\b\s*(.*)$", t, re.S)
    if m and fold(m.group(1)) in {"start", "hilfe", "help", "stand", "status", "neu", "suche", "liste", "merke", "vergiss"}:
        word = fold(m.group(1))
        cmd = {"start": "hilfe", "help": "hilfe", "status": "stand"}.get(word, word)
        t = m.group(2)
    if cmd in ("hilfe", "stand", "liste"):
        return cmd, [], set()
    if cmd == "vergiss":
        return cmd, [t.strip()], set()
    tokens = [x.strip(".-+") for x in re.findall(r"[0-9a-z][0-9a-z.\-+]*", fold(t))]
    tokens = [x for x in tokens if x and x not in STOP]
    store_ids, terms = set(), []
    names = [(s["id"], fold(s["name"]).replace("-", " ")) for s in stores]
    for tok in tokens:
        tok_n = tok.replace("-", " ")
        hit = {sid for sid, n in names if len(tok_n) >= 3 and (tok_n in n.split() or n.startswith(tok_n) or tok_n in n)}
        (store_ids.update(hit) if hit else terms.append(tok))
    return cmd, terms, store_ids


def _hay(o: dict) -> str:
    return fold(" ".join([o.get("title", ""), o.get("product_description", ""), o.get("offer_description", ""),
                          fmt_article(o.get("article_number", "")), o.get("article_number", ""),
                          o.get("condition", ""), o.get("reason_discount", ""), o.get("additional_info", "")]))


def search(db: dict, terms: list[str], store_ids: set[str], since: str | None = None) -> list[dict]:
    out = []
    for o in db.values():
        if o["status"] != "active":
            continue
        if store_ids and o["store_id"] not in store_ids:
            continue
        if since and o["first_seen"] < since:
            continue
        if terms:
            hay = _hay(o)
            arts = o.get("article_numbers") or [o.get("article_number", "")]
            if not all(t in hay or (len(norm_article(t)) == 8 and norm_article(t) in arts) for t in terms):
                continue
        out.append(o)
    return out


def _group(offers: list[dict]) -> list[list[dict]]:
    g: dict[tuple, list] = {}
    for o in offers:
        g.setdefault((o["title"], o.get("product_description", ""), o["store_id"]), []).append(o)
    groups = [sorted(v, key=lambda o: o.get("price") or 0) for v in g.values()]
    return sorted(groups, key=lambda v: (fold(v[0]["title"]), v[0]["store"]))


def _line(grp: list[dict]) -> str:
    e = html.escape
    o = grp[0]
    pct = f" (−{o['discount_pct']:.0f} %)" if o.get("discount_pct") is not None else ""
    n = f"{len(grp)}× " if len(grp) > 1 else ""
    price = _eur(o.get("price")) + (f"–{_eur(grp[-1].get('price'))}" if len(grp) > 1 and grp[-1].get("price") != o.get("price") else "")
    cond = o.get("condition") or o.get("reason_discount") or ""
    return (f"{n}<a href=\"{e(o['link'])}\">{e(o['title'])}</a> {e(o.get('product_description', ''))}\n"
            f"   📍 {e(o['store'])} · <b>{price}</b>{pct}" + (f" · {e(cond)}" if cond else ""))


def _chunks(head: str, lines: list[str], limit: int = 3500) -> list[str]:
    msgs, cur = [], head
    for ln in lines:
        if len(cur) + len(ln) + 2 > limit:
            msgs.append(cur)
            cur = ""
        cur += ("\n\n" if cur else "") + ln
    msgs.append(cur)
    return msgs


def _rule_line(i: int, r: dict, stores: list[dict]) -> str:
    e = html.escape
    names = {s["id"]: s["name"] for s in stores}
    parts = []
    if r.get("keywords"):
        parts.append(" / ".join(r["keywords"]))
    if r.get("article_numbers"):
        parts.append("Art. " + ", ".join(fmt_article(a) for a in r["article_numbers"]))
    if r.get("stores"):
        parts.append("in " + ", ".join(names.get(str(x), str(x)) for x in r["stores"]))
    if r.get("max_price"):
        parts.append(f"bis {_eur(float(r['max_price']))}")
    if r.get("min_discount_pct"):
        parts.append(f"ab {r['min_discount_pct']} %")
    off = " (pausiert)" if r.get("enabled") is False else ""
    return f"{i}. <b>{e(r.get('name', ''))}</b>{off}\n   {e(' · '.join(parts)) or 'trifft alles'}"


def manage(cmd: str, text: str, db: dict, meta: dict) -> list[str]:
    """Merkliste per Telegram: /liste, /merke ..., /vergiss N  (Regeln liegen im Worker)."""
    stores = meta.get("stores", [])
    try:
        w = watch._worker_request("GET")
    except Exception as ex:
        return [f"Merkliste nicht erreichbar: {html.escape(str(ex))}"]
    if w is None:
        return ["Der Merkliste-Server ist nicht eingerichtet (WORKER_URL)."]
    rules = watch.dedupe_rules(w.get("rules", []), w.get("groups"))
    if cmd == "liste":
        if not rules:
            return ["Die Merkliste ist leer. Mit <code>/merke Knivshult Hamburg</code> anlegen."]
        return _chunks("<b>Merkliste</b>", [_rule_line(i + 1, r, stores) for i, r in enumerate(rules)])
    if cmd == "vergiss":
        m = re.search(r"\d+", text)
        if not m or not 1 <= int(m.group()) <= len(rules):
            return ["Welche Regel? <code>/vergiss 3</code> – Nummern siehe /liste."]
        gone = rules.pop(int(m.group()) - 1)
        watch._worker_request("PUT", {"rules": rules, "groups": w.get("groups") or {}})
        return [f"🗑 „{html.escape(gone.get('name', ''))}“ gelöscht. Übrig: {len(rules)}."]
    # merke
    t = text
    price = re.search(r"(?:bis|unter|max\.?)\s*(\d+(?:[.,]\d+)?)\s*(?:€|euro)?", t, re.I)
    max_price = float(price.group(1).replace(",", ".")) if price else None
    if price:
        t = t.replace(price.group(0), " ")
    _, terms, store_ids = parse(t, stores)
    if not terms:
        return ["Was soll ich beobachten? Z. B. <code>/merke Knivshult Hamburg bis 40</code>"]
    rule = {"name": text.strip()[:60], "enabled": True, "keywords": [" ".join(terms)], "exclude": [],
            "article_numbers": [], "conditions": [], "stores": sorted(store_ids), "min_discount_pct": None,
            "max_price": max_price}
    key = watch.rule_key(rule, w.get("groups"))
    if any(watch.rule_key(r, w.get("groups")) == key for r in rules):
        return ["Diese Regel gibt es schon."]
    rules.append(watch.clean_rule(rule))
    watch._worker_request("PUT", {"rules": rules, "groups": w.get("groups") or {}})
    n = len(search(db, terms, store_ids)) if not max_price else \
        len([o for o in search(db, terms, store_ids) if (o.get("price") or 0) <= max_price])
    return [f"✅ Regel {len(rules)} angelegt: {_rule_line(len(rules), rules[-1], stores).split(chr(10), 1)[1].strip()}\n"
            f"Aktuell {n} Treffer. Neue Treffer melde ich ab dem nächsten Abruf."]


def answer(text: str, db: dict, meta: dict, now: datetime | None = None, max_groups: int = 25) -> list[str]:
    now = now or datetime.now(timezone.utc)
    stores = meta.get("stores", [])
    cmd, terms, store_ids = parse(text, stores)
    if cmd == "hilfe":
        return [HELP]
    if cmd in ("liste", "merke", "vergiss"):
        return manage(cmd, text_rest(text), db, meta)
    if cmd == "stand":
        lr = meta.get("last_run", {})
        try:
            age = int((now - datetime.fromisoformat(meta["updated"])).total_seconds() // 60)
            when = f"vor {age} Min." if age < 120 else f"vor {age // 60} Std."
        except Exception:
            when = "unbekannt"
        return [f"Stand: <b>{when}</b>\n{meta.get('active', '?')} aktive Angebote · "
                f"{lr.get('stores_ok', '?')}/{lr.get('stores_total', '?')} Märkte ok"
                + (f"\n⚠️ {html.escape(lr['errors'][:300])}" if lr.get("errors") else "")]
    since = (now - timedelta(hours=24)).isoformat() if cmd == "neu" else None
    if cmd == "suche" and not terms and not store_ids:
        return [HELP]
    found = search(db, terms, store_ids, since)
    where = ", ".join(sorted({s["name"] for s in stores if s["id"] in store_ids})) if store_ids else "allen Märkten"
    what = " ".join(terms)
    title = ("🆕 Neu (24 Std.)" if cmd == "neu" else "🔎") + (f" „{html.escape(what)}“" if what else "") + f" in {html.escape(where)}"
    if not found:
        return [f"{title}\nNichts gefunden."]
    groups = _group(found)
    shown = groups[:max_groups]
    head = f"{title}\n<b>{len(found)} Angebote</b> in {len(groups)} Gruppen"
    lines = [_line(g) for g in shown]
    if len(groups) > max_groups:
        lines.append(f"… und {len(groups) - max_groups} weitere Gruppen. Mit Markt oder genauerem Begriff eingrenzen.")
    return _chunks(head, lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("text")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args(argv)
    meta = storage.read_meta()
    if not meta:
        msgs = ["Noch keine Daten vorhanden."]
        db = {}
    else:
        db = storage.load_db()
        msgs = answer(a.text, db, meta)
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    for m in msgs:
        if a.dry or not (token and chat):
            print(m, "\n---")
        else:
            watch.send_telegram(m, token, chat)
    return 0


if __name__ == "__main__":
    sys.exit(main())
