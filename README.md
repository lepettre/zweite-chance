# Zweite-Chance-Monitor · IKEA Deutschland

Erfasst **alle Zweite-Chance-Angebote** der deutschen IKEA-Märkte stündlich: Name, Beschreibung, Zustand, Grund für den Rabatt bzw. Mangel, Preis, Neupreis, Rabatt (€ und %), Markt, Artikel- und Angebotsnummer und erste/letzte Sichtung. Dazu gibt es eine Web-App mit aktueller Übersicht, Archiv, Merkliste und Statistik. Treffer der Merkliste werden per **Telegram** gemeldet.

> Inoffiziell, nicht mit IKEA verbunden. Die Daten kommen aus der nicht dokumentierten Schnittstelle, die IKEAs eigene Seite nutzt. Sie kann sich jederzeit ändern oder gesperrt werden.

## So funktioniert es

```
GitHub Actions (stündlich)          GitHub Pages (docs/)
  tracker/run.py                      index.html + app.js
   ├─ alle Märkte abrufen  ─────────►  docs/data/*.json, *.csv  ◄── Web-App liest nur diese Dateien
   ├─ Abgleich (merge.py)
   ├─ Telegram (watch.py)
   └─ Rohdaten ─► Release-Assets „raw-JJJJ-MM“
```

Ersatzweg: Ein **Lesezeichen** holt die Daten direkt aus deinem Browser auf ikea.com (falls IKEA die GitHub-Server sperrt). Die Daten landen dann im Monitor (lokal gespeichert). Wird die heruntergeladene Datei in `inbox/` hochgeladen, übernimmt GitHub sie ins zentrale Archiv.

## Einrichtung (ca. 10 Minuten)

1. **Repo anlegen:** Auf GitHub ein neues, **öffentliches** Repository erstellen (z. B. `zweite-chance`). Den Inhalt dieses Ordners hochladen. Wichtig: Auch der versteckte Ordner `.github/` muss mit. Am einfachsten geht das per `git push` oder in GitHub Desktop.
2. **Schreibrechte für den Bot:** *Settings → Actions → General → Workflow permissions →* „Read and write permissions“ → Save.
3. **Website einschalten:** *Settings → Pages → Build and deployment →* Source „Deploy from a branch“, Branch `main`, Ordner `/docs` → Save. Danach ist die App unter `https://<dein-name>.github.io/<repo>/` erreichbar.
4. **Telegram (optional, empfohlen):**
   - In Telegram an `@BotFather` schreiben: `/newbot` → Namen vergeben → **Token** kopieren.
   - Dem neuen Bot eine beliebige Nachricht schicken. Dann `https://api.telegram.org/bot<TOKEN>/getUpdates` öffnen und `"chat":{"id": …}` notieren (**Chat-ID**).
   - *Settings → Secrets and variables → Actions → New repository secret:* `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` anlegen.
5. **Erster Abruf:** *Actions →* „Abruf (stündlich)“ *→ Run workflow*. Nach ca. 5–10 Minuten ist der Lauf fertig.
   - **Grün:** Alles läuft. Ab jetzt wird jede Stunde abgerufen (um :17 UTC; GitHub verzögert gelegentlich).
   - **Rot mit „GESPERRT … HTTP 403/429“:** IKEA blockiert die GitHub-Server. Dann den Lesezeichen-Weg nutzen (Web-App → *Daten & Methodik*).

## Merkliste / Benachrichtigungen

- **Telegram-Regeln** stehen in `config/watchlist.json`. Auf GitHub direkt bearbeiten (Stift-Symbol) oder in der Web-App unter *Merkliste* zusammenklicken und *watchlist.json exportieren*.
- Kriterien (alle optional, werden kombiniert): `keywords` (eines muss passen; mehrere Wörter in einem Eintrag müssen alle vorkommen; Umlaute egal), `exclude`, `article_numbers` (mit oder ohne Punkte), `stores` (Markt-IDs oder Namensteile wie „Hamburg“), `min_discount_pct`, `max_price`, `conditions` (Textteil aus Zustand oder Rabattgrund).
- Gemeldet wird, wenn ein passendes Angebot **neu** erscheint, **wieder auftaucht** oder **billiger** wird. Jede Kombination aus Regel, Angebot und Preis wird nur einmal gemeldet. Beim allerersten Lauf wird nichts gemeldet (`notify_on_first_run` in `config/settings.json`).
- Regeln, die nur in der Web-App angelegt werden, markieren Treffer in der App. Optional gibt es auch Browser-Benachrichtigungen, solange die Seite offen ist.

## Abgleich: Wie Dubletten und Fehlarchivierungen vermieden werden

| Regel | Umsetzung |
|---|---|
| Eindeutiger Schlüssel | `offerUuid` von IKEA. Fallback: Markt + `offerNumber`. Mehrere gleiche Produkte sind getrennte Angebote. |
| Dubletten in einer Antwort | werden verworfen |
| „Verschwunden“ | erst nach **2 aufeinanderfolgenden erfolgreichen** Abrufen des Markts ohne das Angebot |
| Marktausfall / Sperre | Bestand dieses Markts bleibt unverändert |
| Markt meldet plötzlich 0 Angebote bei ≥ 10 im Bestand | wird als Störung gewertet, nicht als Abverkauf |
| Wieder aufgetaucht | derselbe Datensatz wird reaktiviert (`reappear_count`) |
| Preis- oder Textänderung | Ereignis im Protokoll; `price_history` |
| Alte Snapshots (Lesezeichen) | werden abgelehnt, damit die Zeitachse nicht durcheinandergerät |

Die Browser-Logik (`docs/core.js`) und der Python-Tracker (`tracker/merge.py`) folgen denselben Regeln. Beides wird bei jedem Lauf getestet.

## Daten für Auswertungen

| Datei | Inhalt |
|---|---|
| `docs/data/exports/offers_all.csv(.gz)` | **alle** Angebote, eine Zeile je Angebot, inkl. `days_listed`, `first_price`, `min_price` (täglich gegen 03 Uhr UTC und bei manuellem Lauf) |
| `docs/data/current.json` | aktive Angebote (ein Angebot pro Zeile) |
| `docs/data/archive/JJJJ-MM.json` | verschwundene Angebote nach Monat |
| `docs/data/events/JJJJ-MM.csv` | Ereignisprotokoll: `new`, `gone`, `reappeared`, `price_change`, `changed` |
| `docs/data/runs.csv` | jeder Abruf: Märkte ok/fehlerhaft, Zahlen, Dauer, Fehler |
| Releases `raw-JJJJ-MM` | **unveränderte API-Antworten** jedes Abrufs (gzip-JSON). Damit ist alles nachprüfbar und neu berechenbar. |

Alle Zeiten sind in UTC (ISO 8601). Wichtig für die Interpretation:
- **IKEA liefert kein Einstelldatum.** `first_seen`/`last_seen` sind eigene Beobachtungen, genau auf etwa eine Stunde. Angebote, die schon vor dem ersten Abruf gelistet waren, haben ein zu spätes `first_seen`.
- **„Verschwunden“ ≠ verkauft:** Das Angebot kann auch reserviert oder entfernt worden sein.
- `reason_discount` ist Freitext der Märkte und muss vor Auswertungen gruppiert werden.

Beispiel: `python analysis/auswertung_beispiel.py docs/data/exports/offers_all.csv`

## Lokal ausführen / testen

```bash
python -m tracker.run              # Live-Abruf (curl_cffi empfohlen, siehe requirements.txt)
python -m tracker.run --ingest datei.json   # Lesezeichen-Snapshot einspielen
python -m unittest discover -s tests && node tests/test_core.js
python -m http.server -d docs 8000 # Web-App unter http://localhost:8000
```

## Grenzen

- Die Schnittstelle ist inoffiziell. Ändert IKEA das Format, wird der Lauf rot und GitHub schickt dir eine Mail. Dann ist eine Anpassung in `tracker/normalize.py` nötig.
- GitHub kann Zeitpläne verzögern. Bei längerer Inaktivität im Repo pausiert GitHub Zeitpläne; unter *Actions* lassen sie sich wieder aktivieren.
- Abgerufen wird zurückhaltend: ein Durchlauf pro Stunde, Pausen zwischen den Anfragen. Bei 403/429 wird sofort abgebrochen und nichts erzwungen.
