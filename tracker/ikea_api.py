"""Zugriff auf die (inoffizielle) IKEA-As-is-API.

Endpunkte (aus IKEAs eigener Web-App, nicht dokumentiert):
  GET {API_ROOT}/api/public/stores/{country}
  GET {API_ROOT}/offers/grouped/search?languageCode=de&storeIds=..&size=64&page=..
"""
from __future__ import annotations

import json
import os
import random
import time
import urllib.parse
import urllib.request

API_ROOT = os.environ.get("IKEA_API_ROOT", "https://web-api.ikea.com/circular/circular-asis")
# Oeffentlicher Client-Key aus IKEAs Web-App; per Umgebungsvariable ueberschreibbar.
CLIENT_ID = os.environ.get("IKEA_CLIENT_ID", "d530fa19-39b9-4f3f-9276-61146d470502")
PAGE_SIZE = 64          # API-Maximum
MAX_PAGES = 60          # Schutz vor Endlosschleifen
TIMEOUT = 45
PAUSE = (0.8, 1.8)      # hoefliche Pause zwischen Requests (Sekunden)

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "de-DE,de;q=0.9",
    "origin": "https://www.ikea.com",
    "referer": "https://www.ikea.com/",
    "x-client-id": CLIENT_ID,
    "user-agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
}


class BlockedError(RuntimeError):
    """HTTP 403/429 - Bot-Schutz oder Rate-Limit. Nicht aggressiv wiederholen."""


try:  # curl_cffi imitiert den TLS-Fingerabdruck eines Browsers (hilft gegen Akamai)
    from curl_cffi import requests as _cffi  # type: ignore
except Exception:  # pragma: no cover
    _cffi = None


def _get(url: str, params: dict | None = None, retries: int = 3) -> object:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            if _cffi is not None:
                r = _cffi.get(url, headers=HEADERS, timeout=TIMEOUT, impersonate="chrome124")
                status, body = r.status_code, r.content
            else:
                req = urllib.request.Request(url, headers=HEADERS)
                try:
                    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                        status, body = resp.status, resp.read()
                except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
                    status, body = e.code, e.read()
            if status == 200:
                return json.loads(body)
            if status in (403, 429):
                raise BlockedError(f"HTTP {status} fuer {url}")
            last = RuntimeError(f"HTTP {status} fuer {url}: {body[:200]!r}")
        except BlockedError:
            raise
        except Exception as e:  # Netzwerkfehler, JSON-Fehler ...
            last = e
        time.sleep(2 ** attempt + random.random())
    raise RuntimeError(f"Abruf fehlgeschlagen: {last}")


def pause() -> None:
    time.sleep(random.uniform(*PAUSE))


def fetch_stores(country: str = "de") -> list[dict]:
    data = _get(f"{API_ROOT}/api/public/stores/{country}")
    if not isinstance(data, list):
        raise RuntimeError(f"Unerwartete Store-Antwort: {str(data)[:200]}")
    return data


def fetch_store(store_id: str, language: str = "de") -> dict:
    """Alle Seiten eines Markts. Rueckgabe: {"content": [...], "pages": n, "totalElements": x}"""
    content: list = []
    page, total_pages, total_elements = 0, None, None
    while page < MAX_PAGES:
        data = _get(f"{API_ROOT}/offers/grouped/search", {
            "languageCode": language, "size": PAGE_SIZE, "storeIds": store_id, "page": page,
        })
        if not isinstance(data, dict) or not isinstance(data.get("content"), list):
            raise RuntimeError(f"Unerwartetes Format (Markt {store_id}, Seite {page})")
        content.extend(data["content"])
        total_pages = data.get("totalPages")
        total_elements = data.get("totalElements", total_elements)
        if data.get("last") is True or (total_pages is not None and page + 1 >= total_pages) \
                or len(data["content"]) < PAGE_SIZE:
            break
        page += 1
        pause()
    else:
        raise RuntimeError(f"MAX_PAGES erreicht bei Markt {store_id} - Daten unvollstaendig")
    return {"content": content, "pages": page + 1, "totalPages": total_pages,
            "totalElements": total_elements}
