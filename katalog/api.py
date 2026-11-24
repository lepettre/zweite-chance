"""Abruf der oeffentlichen IKEA-Seiten (Listen, Sitemaps). Schonend: wenige Verbindungen, Pausen, Abbruch bei Sperre."""
from __future__ import annotations

import gzip
import json
import random
import re
import time
import urllib.request

BASE = "https://www.ikea.com"
PLP = "https://sik.search.blue.cdtapps.com/de/de/product-list-page"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36")
HEADERS = {"user-agent": UA, "accept-language": "de-DE,de;q=0.9", "accept-encoding": "gzip",
           "origin": BASE, "referer": BASE + "/"}
PAUSE = (0.3, 0.9)

try:  # Browser-aehnlicher TLS-Fingerabdruck wie beim Fundgrube-Tracker
    from curl_cffi import requests as _cffi  # type: ignore
except Exception:  # pragma: no cover
    _cffi = None


class Blocked(RuntimeError):
    """HTTP 403/429: nicht erzwingen."""


def pause() -> None:
    time.sleep(random.uniform(*PAUSE))


def _open(url: str, timeout: int = 60, headers: dict | None = None) -> tuple[int, bytes]:
    h = {**HEADERS, **(headers or {})}
    if _cffi is not None:
        r = _cffi.get(url, headers=h, timeout=timeout, impersonate="chrome124")
        return r.status_code, r.content
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            if resp.headers.get("content-encoding") == "gzip":
                body = gzip.decompress(body)
            return resp.status, body
    except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
        return e.code, e.read()


def get(url: str, retries: int = 3, timeout: int = 60, headers: dict | None = None) -> bytes:
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            status, body = _open(url, timeout, headers)
            if status == 200:
                return body
            if status in (403, 429):
                raise Blocked(f"HTTP {status} fuer {url}")
            if status == 404:
                raise FileNotFoundError(url)
            last = RuntimeError(f"HTTP {status} fuer {url}")
        except (Blocked, FileNotFoundError):
            raise
        except Exception as e:
            last = e
        time.sleep(2 ** attempt + random.random())
    raise RuntimeError(f"Abruf fehlgeschlagen: {last}")


def get_json(url: str, **kw):
    return json.loads(get(url, **kw))


# Verfuegbarkeit je Markt (Sortiment "inRange" + Bestand). Oeffentlicher Client-Schluessel der IKEA-Webseite.
AVAIL = "https://api.salesitem.ingka.com/availabilities/sto"
AVAIL_HEADERS = {"X-Client-ID": "b6c117e5-ae61-4ef5-b4cc-e0b1e37f0631", "accept": "application/json;version=2"}
AVAIL_MAX = 50


def stores() -> list[dict]:
    raw = get_json(f"{BASE}/de/de/meta-data/informera/stores-detailed.json")
    return [{"id": s["id"], "name": s.get("displayName") or s.get("name", s["id"]), "lat": float(s["lat"]), "lng": float(s["lng"])}
            for s in raw if not s.get("hideStore") and s.get("cashAndCarry")]


def availabilities(store_id: str, item_nos: list[str]) -> list[dict]:
    assert 0 < len(item_nos) <= AVAIL_MAX
    d = get_json(f"{AVAIL}/{store_id}?itemNos={','.join(item_nos)}", headers=AVAIL_HEADERS, timeout=40)
    return d.get("availabilities") or []


def category_ids() -> list[str]:
    """Kategorie-Schluessel aus den Kategorie-Sitemaps (cat-de-DE_N.xml)."""
    index = get(f"{BASE}/sitemaps/sitemap.xml").decode("utf-8", "replace")
    maps = sorted(set(re.findall(r"<loc>(https://www\.ikea\.com/sitemaps/cat-de-DE_\d+\.xml)</loc>", index)))
    ids: list[str] = []
    for m in maps:
        text = get(m, timeout=120).decode("utf-8", "replace")
        ids += re.findall(r"/de/de/cat/[^<]*?-([0-9a-z]+)/</loc>", text)
        pause()
    return sorted(set(ids))


def fetch_category(key: str) -> dict:
    return get_json(f"{PLP}?category={key}&size=1000")["productListPage"]


def sitemap_urls() -> list[str]:
    index = get(f"{BASE}/sitemaps/sitemap.xml").decode("utf-8", "replace")
    return sorted(set(re.findall(r"<loc>(https://www\.ikea\.com/sitemaps/prod-de-DE_\d+\.xml)</loc>", index)))


def parse_sitemap(text: str) -> dict[str, str]:
    """Produktseiten-Sitemap -> {Artikel-ID (mit 's' bei Sets): URL-Teil}."""
    out = {}
    for m in re.finditer(r"<loc>https://www\.ikea\.com/de/de/p/([^<]+?-(s?\d{8}))/?</loc>", text):
        out[m.group(2)] = m.group(1)
    return out


def fetch_product_json(art: str) -> dict:
    return get_json(f"{BASE}/de/de/products/{art[-3:]}/{art}.json", retries=1)
