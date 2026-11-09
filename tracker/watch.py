"""Beobachtungsregeln (config/watchlist.json) + Telegram-Benachrichtigung."""
from __future__ import annotations

import html
import json
import os
import urllib.parse
import urllib.request

from .normalize import fold, norm_article

NOTIFY_TYPES = {"new", "reappeared", "price_drop"}


def _list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def matches(rule: dict, o: dict) -> bool:
    if rule.get("enabled") is False:
        return False
    hay = fold(" ".join([o.get("title", ""), o.get("product_description", ""), o.get("offer_description", "")]))
    kws = [fold(k) for k in _list(rule.get("keywords")) if k]
    arts = [norm_article(a) for a in _list(rule.get("article_numbers")) if a]
    if kws or arts:
        hit_kw = any(all(part in hay for part in k.split()) for k in kws)
        hit_art = any(a in (o.get("article_numbers") or [o.get("article_number", "")]) for a in arts)
        if not (hit_kw or hit_art):
            return False
    if any(fold(x) in hay for x in _list(rule.get("exclude")) if x):
        return False
    stores = [fold(str(s)) for s in _list(rule.get("stores")) if s]
    if stores and not any(s == fold(o["store_id"]) or s in fold(o.get("store", "")) for s in stores):
        return False
    if rule.get("min_discount_pct") is not None:
        if o.get("discount_pct") is None or o["discount_pct"] < float(rule["min_discount_pct"]):
            return False
    if rule.get("max_price") is not None:
        if o.get("price") is None or o["price"] > float(rule["max_price"]):
            return False
    conds = [fold(c) for c in _list(rule.get("conditions")) if c]
    if conds:
        ctext = fold(" ".join([o.get("condition", ""), o.get("condition_description", ""),
                               o.get("reason_discount", ""), o.get("additional_info", "")]))
        if not any(c in ctext for c in conds):
            return False
    return True


def triggers(events: list[dict]) -> dict[str, tuple[str, str]]:
    """id -> (Ausloeser, Ereigniszeit); ein Wiederauftauchen darf erneut melden."""
    out = {}
    for e in events:
        t = e["type"]
        if t == "price_change":
            try:
                if float(e["new_price"]) < float(e["old_price"]):
                    t = "price_drop"
            except (TypeError, ValueError):
                continue
        if t in NOTIFY_TYPES:
            out[e["id"]] = (t, str(e.get("ts") or ""))
    return out


def _canon_list(v, fn):
    return sorted({fn(str(x)) for x in _list(v) if str(x).strip()})


def expand_stores(rule: dict, groups: dict | None) -> list[str]:
    """'@Hamburg' -> Markt-IDs der Gruppe; alles andere bleibt (ID oder Namensteil)."""
    out = []
    for s in _list(rule.get("stores")):
        s = str(s).strip()
        if not s:
            continue
        if s.startswith("@"):
            g = (groups or {}).get(s[1:]) or next((v for k, v in (groups or {}).items()
                                                   if fold(k) == fold(s[1:])), None)
            out.extend(str(x) for x in (g or []))
        else:
            out.append(s)
    return sorted(set(out))


def clean_rule(rule: dict) -> dict:
    """Artikelnummern ohne 8 Ziffern sind in Wahrheit Stichworte (z. B. 'IKEA PS 2026')."""
    r = dict(rule)
    arts = []
    kws = [str(x).strip() for x in _list(r.get("keywords")) if str(x).strip()]
    for a in _list(r.get("article_numbers")):
        a = str(a).strip()
        if len(norm_article(a)) == 8:
            arts.append(a)
        elif a:
            kws.append(a)
    r["article_numbers"], r["keywords"] = arts, kws
    return r


def rule_key(rule: dict, groups: dict | None = None) -> str:
    """Inhaltlicher Schluessel: gleiche Kriterien = gleiche Regel, egal wie sie heisst."""
    r = clean_rule(rule)
    parts = [
        ",".join(_canon_list(r.get("keywords"), lambda x: " ".join(sorted(fold(x).split())))),
        ",".join(_canon_list(r.get("exclude"), fold)),
        ",".join(_canon_list(r.get("article_numbers"), norm_article)),
        ",".join(fold(x) for x in expand_stores(r, groups)),
        str(r.get("min_discount_pct") if r.get("min_discount_pct") not in ("", None) else ""),
        str(r.get("max_price") if r.get("max_price") not in ("", None) else ""),
        ",".join(_canon_list(r.get("conditions"), fold)),
    ]
    return "|".join(parts)


def dedupe_rules(rules: list[dict], groups: dict | None = None) -> list[dict]:
    """Doppelte Regeln (gleiche Kriterien) entfernen; aktiv schlaegt pausiert."""
    seen: dict[str, int] = {}
    out: list[dict] = []
    for r in rules:
        r = clean_rule(r)
        k = rule_key(r, groups)
        if k in seen:
            prev = out[seen[k]]
            if prev.get("enabled") is False and r.get("enabled") is not False:
                prev["enabled"] = True
            continue
        seen[k] = len(out)
        out.append(r)
    return out


def _worker_request(method: str, body: dict | None = None):
    url, pw = os.environ.get("WORKER_URL", "").rstrip("/"), os.environ.get("ZC_PASSWORD", "")
    if not (url and pw):
        return None
    req = urllib.request.Request(f"{url}/api/watchlist", method=method, headers={
        "x-key": pw, "content-type": "application/json", "user-agent": "zc-tracker"},
        data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read() or b"null")


def load_watchlist(legacy_path=None) -> tuple[list[dict], dict, str]:
    """Merkliste laden. Reihenfolge: Worker (Quelle der Wahrheit) -> letzte Sicherung -> Altbestand.
    Rueckgabe: (Regeln, Marktgruppen, Quelle)."""
    from . import storage
    remote = None
    try:
        remote = _worker_request("GET")
    except Exception as ex:
        print(f"[watch] Worker nicht erreichbar ({ex}) - nutze letzte Sicherung.")
    saved = storage.read_bin("watchlist.bin", None)
    legacy = storage.read_json(legacy_path, None) if legacy_path else None
    if remote is not None and (remote.get("rules") or not (saved or legacy)):
        w, src = remote, "worker"
    elif saved and saved.get("rules"):
        w, src = saved, "sicherung"
    elif legacy:
        w, src = legacy, "altbestand"
    else:
        w, src = {}, "leer"
    groups = {k: [str(x) for x in v] for k, v in (w.get("store_groups") or w.get("groups") or {}).items()}
    rules = dedupe_rules(w.get("rules", []), groups)
    if remote is not None and not remote.get("rules") and rules:     # Worker einmalig befuellen
        try:
            _worker_request("PUT", {"rules": rules, "groups": groups})
            print(f"[watch] {len(rules)} Regeln in den Worker uebernommen.")
        except Exception as ex:
            print(f"[watch] Worker konnte nicht befuellt werden: {ex}")
    return rules, groups, src


def find_hits(rules: list[dict], db: dict, events: list[dict], notified: dict,
              groups: dict | None = None) -> list[tuple]:
    """Ein Treffer je Angebot und Preis - auch wenn mehrere Regeln passen."""
    hits = []
    rules = dedupe_rules(rules, groups)
    for oid, (why, event_ts) in triggers(events).items():
        o = db.get(oid)
        if not o or o["status"] != "active":
            continue
        key = f"{oid}|{o.get('price')}|{why}|{event_ts}"
        if key in notified:
            continue
        names, was_sent = [], False
        for i, rule in enumerate(rules):
            name = rule.get("name") or f"Regel {i + 1}"
            if not matches({**rule, "stores": expand_stores(rule, groups)}, o):
                continue
            if f"{name}|{oid}|{o.get('price')}" in notified:   # Schluessel der Vorversion
                was_sent = True
            elif name not in names:
                names.append(name)
        if names and not was_sent:
            hits.append((" · ".join(names), why, o, key))
    return hits


WHY = {"new": "🆕 Neu", "reappeared": "🔁 Wieder da", "price_drop": "📉 Preis gesenkt"}


def _fmt_eur(v):
    return "–" if v is None else f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def format_hit(rule_name, why, o) -> str:
    e = html.escape
    lines = [f"<b>{e(WHY.get(why, why))} · {e(rule_name)}</b>",
             f"<a href=\"{e(o['link'])}\">{e(o['title'])}</a> – {e(o.get('product_description', ''))}",
             f"📍 {e(o['store'])}",
             f"💶 <b>{_fmt_eur(o.get('price'))}</b> statt {_fmt_eur(o.get('original_price'))}"
             + (f" (−{o['discount_pct']:.0f} %)" if o.get("discount_pct") is not None else "")]
    cond = " · ".join(x for x in [o.get("condition"), o.get("reason_discount"), o.get("additional_info")] if x)
    if cond:
        lines.append(f"🏷 {e(cond)}")
    lines.append(f"<code>Art. {e(o.get('article_number', ''))} · Angebot {e(o.get('offer_number', ''))}</code>")
    return "\n".join(lines)


def send_telegram(text: str, token: str, chat_id: str, preview_url: str | None = None) -> None:
    body = {"chat_id": chat_id, "text": text[:4000], "parse_mode": "HTML",
            "link_preview_options": json.dumps({"is_disabled": not preview_url, "url": preview_url or "",
                                                "prefer_small_media": True})}
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage",
                                 data=urllib.parse.urlencode(body).encode())
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()


def _product_key(o: dict) -> str:
    return o.get("article_number") or (fold(o.get("title", "")) + "|" + fold(o.get("product_description", "")))


def format_group(rule_name, why, offers: list[dict], max_lines: int = 8) -> str:
    """Mehrere gleiche Artikel (gleiche Regel, gleicher Anlass) in EINER Nachricht."""
    if len(offers) == 1:
        return format_hit(rule_name, why, offers[0])
    e = html.escape
    offers = sorted(offers, key=lambda o: (o.get("price") is None, o.get("price") or 0, o.get("store", "")))
    first = offers[0]
    lines = [f"<b>{e(WHY.get(why, why))} · {e(rule_name)}</b>",
             f"<a href=\"{e(first['link'])}\">{e(first['title'])}</a> – {e(first.get('product_description', ''))}",
             f"<b>{len(offers)}× verfügbar</b>"]
    for o in offers[:max_lines]:
        pct = f" (−{o['discount_pct']:.0f} %)" if o.get("discount_pct") is not None else ""
        cond = o.get("condition") or o.get("reason_discount") or ""
        lines.append(f"📍 {e(o['store'])} · <a href=\"{e(o['link'])}\"><b>{_fmt_eur(o.get('price'))}</b></a>{pct}"
                     + (f" · {e(cond)}" if cond else ""))
    if len(offers) > max_lines:
        lines.append(f"… und {len(offers) - max_lines} weitere")
    lines.append(f"<code>Art. {e(first.get('article_number', ''))}</code>")
    return "\n".join(lines)


def queue(hits: list[tuple], notified: dict, ts: str, max_messages: int = 15) -> list[dict]:
    """Treffer vormerken, gleiche Artikel je Regel/Anlass zu einer Nachricht gebuendelt.
    Gesendet wird erst NACH dem Veroeffentlichen (send_outbox), damit ein abgebrochener Lauf
    keine Doppelmeldungen erzeugt."""
    groups: dict[tuple, dict] = {}
    for rule_name, why, o, key in hits:
        g = groups.setdefault((rule_name, why, _product_key(o)),
                              {"rule": rule_name, "why": why, "offers": [], "keys": []})
        g["offers"].append(o)
        g["keys"].append(key)
    msgs = []
    for g in list(groups.values())[:max_messages]:
        cheapest = min(g["offers"], key=lambda o: (o.get("price") is None, o.get("price") or 0))
        msgs.append({"key": g["keys"][0], "keys": g["keys"], "text": format_group(g["rule"], g["why"], g["offers"]),
                     "preview": cheapest.get("image") or None, "offer_id": cheapest["id"]})
    rest = len(groups) - max_messages
    if rest > 0:
        msgs.append({"key": f"rest|{ts}", "text": f"… und {rest} weitere Treffer. Alle in der Web-App unter „Merkliste“.",
                     "preview": None})
    for *_, key in hits:
        notified[key] = ts
    return msgs


def send_outbox(state: dict) -> tuple[int, int]:
    """Vorgemerkte Nachrichten senden (state["outbox"]). Fehlgeschlagene bleiben fuer den naechsten Lauf liegen."""
    box = state.get("outbox") or []
    if not box:
        return 0, 0
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (token and chat):
        print(f"[watch] {len(box)} Nachrichten, aber TELEGRAM_BOT_TOKEN/CHAT_ID fehlen - verworfen.")
        state["outbox"] = []
        return 0, 0
    left, sent, done = [], 0, set()
    for m in box:
        if m["key"] in done:          # Sicherheitsnetz gegen Doppelte im Postausgang
            continue
        try:
            send_telegram(m["text"], token, chat, m.get("preview"))
            sent += 1
            done.add(m["key"])
        except Exception as ex:
            print(f"[watch] Telegram-Fehler: {ex}")
            m["tries"] = m.get("tries", 0) + 1
            if m["tries"] < 5:
                left.append(m)
    state["outbox"] = left
    return sent, len(left)
