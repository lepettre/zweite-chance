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


def triggers(events: list[dict]) -> dict[str, str]:
    """id -> Ausloeser (new | reappeared | price_drop)."""
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
            out[e["id"]] = t
    return out


def find_hits(rules: list[dict], db: dict, events: list[dict], notified: dict) -> list[tuple]:
    hits = []
    for oid, why in triggers(events).items():
        o = db.get(oid)
        if not o or o["status"] != "active":
            continue
        for i, rule in enumerate(rules):
            name = rule.get("name") or f"Regel {i + 1}"
            key = f"{name}|{oid}|{o.get('price')}"
            if key in notified or not matches(rule, o):
                continue
            hits.append((name, why, o, key))
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


def notify(hits: list[tuple], notified: dict, ts: str, max_messages: int = 25) -> int:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not hits:
        return 0
    if not (token and chat):
        print(f"[watch] {len(hits)} Treffer, aber TELEGRAM_BOT_TOKEN/CHAT_ID fehlen - nur protokolliert.")
        for _, _, _, key in hits:
            notified[key] = ts
        return 0
    sent = 0
    for rule_name, why, o, key in hits[:max_messages]:
        try:
            send_telegram(format_hit(rule_name, why, o), token, chat, o.get("image") or None)
            notified[key] = ts
            sent += 1
        except Exception as ex:  # naechster Lauf versucht es erneut
            print(f"[watch] Telegram-Fehler: {ex}")
    rest = len(hits) - max_messages
    if rest > 0:
        try:
            send_telegram(f"… und {rest} weitere Treffer. Alle in der Web-App unter „Merkliste“.", token, chat)
        except Exception:
            pass
        for _, _, _, key in hits[max_messages:]:
            notified[key] = ts
    return sent
