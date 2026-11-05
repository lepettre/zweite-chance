"""Startpunkt fuer eigene Auswertungen (pandas).

    python analysis/auswertung_beispiel.py https://<user>.github.io/<repo>/data/exports/offers_all.csv.gz
oder mit lokalem Pfad: docs/data/exports/offers_all.csv
"""
import sys

import pandas as pd

src = sys.argv[1] if len(sys.argv) > 1 else "docs/data/exports/offers_all.csv"
df = pd.read_csv(src, parse_dates=["first_seen", "last_seen", "gone_at"], dtype={"article_number": str})
gone = df[df.status == "gone"]

print(f"{len(df):,} Angebote erfasst, davon {(df.status == 'active').sum():,} aktiv\n")
print("Median-Rabatt je Markt (%):")
print(df.groupby("store").discount_pct.median().sort_values(ascending=False).round(1).to_string(), "\n")
print("Haeufigste Rabattgruende:")
print(df.reason_discount.fillna("–").value_counts().head(15).to_string(), "\n")
print("Median-Verweildauer verschwundener Angebote (Tage) nach Zustand:")
print(gone.groupby("condition").days_listed.agg(["median", "count"]).query("count >= 5").sort_values("median").round(1).to_string())
