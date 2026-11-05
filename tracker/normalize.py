"""API-Rohdaten -> flache, stabile Angebots-Datensaetze."""
from __future__ import annotations

import hashlib
import re
import unicodedata

IKEA_PAGE = "https://www.ikea.com/de/de/second-hand/buy-from-ikea/"


def store_name(raw_name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"^IKEA\s+", "", raw_name or "", flags=re.I)).strip()


# Slugs aus der IKEA-URL (Stand Recherche), Schluessel = nur Buchstaben/Ziffern
KNOWN_SLUGS = ['augsburg', 'berlinlichtenberg', 'berlinspandau', 'berlintempelhof', 'berlinwaltersdorf', 'bielefeld', 'braunschweig', 'bremerhaven', 'brinkum', 'chemnitz', 'dortmund', 'dresden', 'duisburg', 'düsseldorf', 'erfurt', 'essen', 'frankfurt', 'freiburg', 'halleleipzig', 'hamburgaltona', 'hamburgmoorfleet', 'hamburgschnelsen', 'hanau', 'hannover+expopark', 'hannovergroßburgwedel', 'kaarst', 'kaiserslautern', 'kamen', 'karlsruhe', 'kassel', 'kiel', 'koblenz', 'kölnam+butzweilerhof', 'kölngodorf', 'lübeck', 'ludwigsburg', 'magdeburg', 'mannheim', 'münchenbrunnthal', 'müncheneching', 'nürnbergfürth', 'oldenburg', 'osnabrück', 'regensburg', 'rostock', 'saarlouis', 'siegen', 'sindelfingen', 'ulm', 'wallau', 'walldorf', 'wetzlar', 'wuppertal', 'würzburg']


def _alnum(s: str) -> str:
    return re.sub(r"[^0-9a-zäöüß]", "", (s or "").lower())


def store_slug(name: str) -> str:
    for slug in KNOWN_SLUGS:
        if _alnum(slug) == _alnum(name):
            return slug
    return _heuristic_slug(name)


def _heuristic_slug(name: str) -> str:
    """'Berlin-Lichtenberg' -> 'berlinlichtenberg', 'Hannover EXPO Park' -> 'hannover+expopark'?

    IKEA nutzt im Hash: Kleinbuchstaben, Bindestrich/Slash entfernt, Leerzeichen -> '+'.
    Beobachtet: 'hannover+expopark', 'kölnam+butzweilerhof', 'nürnbergfürth'.
    Abweichungen koennen in config/settings.json -> store_slugs ueberschrieben werden.
    """
    s = name.lower().replace("-", "").replace("/", "")
    s = re.sub(r"\s+", "+", s.strip())
    return s


def offer_link(slug: str | None, offer_number: str | None) -> str:
    if slug and offer_number:
        return f"{IKEA_PAGE}#/{slug}/{offer_number}"
    if slug:
        return f"{IKEA_PAGE}#/{slug}"
    return IKEA_PAGE


def fold(text: str | None) -> str:
    """Suchnormalisierung: klein, Umlaute aufgeloest, Akzente entfernt."""
    t = (text or "").casefold().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    t = unicodedata.normalize("NFKD", t)
    return "".join(c for c in t if not unicodedata.combining(c))


def norm_article(n: str | None) -> str:
    return re.sub(r"\D", "", n or "")


def fmt_article(n: str | None) -> str:
    d = norm_article(n)
    return f"{d[:3]}.{d[3:6]}.{d[6:]}" if len(d) == 8 else (n or "")


def _num(v):
    try:
        return round(float(v), 2) if v is not None else None
    except (TypeError, ValueError):
        return None


def _txt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return "; ".join(_txt(x) for x in v if x)
    if isinstance(v, dict):
        return "; ".join(f"{k}: {_txt(x)}" for k, x in v.items() if x)
    return re.sub(r"\s+", " ", str(v)).strip()


# Felder, deren Aenderung als "changed"-Ereignis gilt (Preis separat)
DESCRIPTIVE = ("title", "product_description", "offer_description", "condition", "condition_description",
               "reason_discount", "additional_info", "original_price")


def offer_key(store_id: str, offer: dict) -> str | None:
    """Eindeutiger Schluessel: offerUuid, sonst Markt + offerNumber, sonst Markt + id."""
    if offer.get("offerUuid"):
        return f"u:{offer['offerUuid']}"
    if offer.get("offerNumber"):
        return f"n:{store_id}:{offer['offerNumber']}"
    if offer.get("id"):
        return f"i:{store_id}:{offer['id']}"
    return None


def flatten(content: list, store_id: str, stores: dict, slugs: dict) -> list[dict]:
    out = []
    st = stores.get(str(store_id), {})
    for group in content or []:
        sid = str(group.get("storeId") or store_id)
        st = stores.get(sid, st)
        arts = [norm_article(a) for a in (group.get("articleNumbers") or []) if a]
        orig = _num(group.get("originalPrice"))
        for offer in group.get("offers") or []:
            key = offer_key(sid, offer)
            if not key:
                continue
            price = _num(offer.get("price"))
            disc = round(orig - price, 2) if orig is not None and price is not None else None
            pct = round(disc / orig * 100, 1) if disc is not None and orig else None
            slug = slugs.get(sid) or st.get("slug")
            rec = {
                "id": key,
                "offer_uuid": offer.get("offerUuid") or "",
                "offer_number": str(offer.get("offerNumber") or ""),
                "store_id": sid,
                "store": st.get("name", sid),
                "title": _txt(group.get("title")),
                "product_description": _txt(group.get("description")),
                "offer_description": _txt(offer.get("description")),
                "article_number": arts[0] if arts else "",
                "article_numbers": arts,
                "condition": _txt(offer.get("productConditionTitle")),
                "condition_code": _txt(offer.get("productConditionCode")),
                "condition_description": _txt(offer.get("productConditionDescription")),
                "reason_discount": _txt(offer.get("reasonDiscount")),
                "additional_info": _txt(offer.get("additionalInfo")),
                "price": price,
                "original_price": orig,
                "discount_eur": disc,
                "discount_pct": pct,
                "currency": group.get("currency") or "EUR",
                "image": group.get("heroImage") or "",
                "link": offer_link(slug, str(offer.get("offerNumber") or "")),
            }
            out.append(rec)
    return out


def content_hash(rec: dict) -> str:
    s = "\x1f".join(str(rec.get(k, "")) for k in DESCRIPTIVE)
    return hashlib.sha1(s.encode()).hexdigest()[:12]
