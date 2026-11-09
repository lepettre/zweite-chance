"""Prueft vor dem Entfernen des Klartext-Altbestands, dass wirklich alles im verschluesselten Bestand steckt.

  python -m tracker.verify      # Exit 0 = alles uebernommen, sonst Exit 1 mit Begruendung
"""
from __future__ import annotations

import sys

from . import storage, watch


def main() -> int:
    problems = []
    meta = storage.read_meta()
    if not meta:
        problems.append("Kein verschluesselter Bestand (meta.bin) vorhanden.")
    else:
        new_ids = set(storage.load_db())
        legacy_ids = set(storage._load_legacy())            # Angebote + Archiv + Verlauf aus Klartext
        missing = legacy_ids - new_ids
        if missing:
            problems.append(f"{len(missing)} Angebote des Altbestands fehlen im neuen Bestand.")
        saved = storage.read_bin("watchlist.bin", None) or {}
        old_rules = storage.read_json(storage.ROOT / "config" / "watchlist.json", {}).get("rules", [])
        keys_new = {watch.rule_key(r) for r in saved.get("rules", [])}
        keys_old = {watch.rule_key(r) for r in watch.dedupe_rules(old_rules)}
        if keys_old - keys_new:
            problems.append(f"{len(keys_old - keys_new)} Merklisten-Regeln fehlen in der Sicherung.")
        if not storage.read_runs():
            problems.append("Abruf-Protokoll fehlt.")
    for p in problems:
        print("[verify] PROBLEM:", p)
    if not problems:
        print("[verify] Alles uebernommen: Angebote, Archiv, Verlauf, Merkliste, Protokoll.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
