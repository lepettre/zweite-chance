import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path


def group(store, title, art, orig, offers, desc="Regal, weiß"):
    return {"storeId": store, "title": title, "description": desc, "articleNumbers": [art],
            "originalPrice": orig, "currency": "EUR", "heroImage": "https://x/img.jpg", "offers": offers}


def offer(uuid, num, price, cond="Gebraucht – guter Zustand", reason="Ausstellungsstück"):
    return {"offerUuid": uuid, "offerNumber": num, "price": price,
            "productConditionTitle": cond, "reasonDiscount": reason}


STORES = [{"store_id": "148", "name": "IKEA Berlin-Lichtenberg", "active": True},
          {"store_id": "124", "name": "IKEA Hannover EXPO Park", "active": True}]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "config").mkdir()
        repo = Path(__file__).resolve().parent.parent
        shutil.copy(repo / "config" / "settings.json", self.tmp / "config")
        (self.tmp / "config" / "watchlist.json").write_text(json.dumps({"rules": [
            {"name": "Kallax billig", "keywords": ["kallax"], "min_discount_pct": 20}]}))
        os.environ["TRACKER_ROOT"] = str(self.tmp)
        import importlib
        import tracker.storage, tracker.run, tracker.ikea_api
        importlib.reload(tracker.storage); importlib.reload(tracker.run)
        self.run, self.storage, self.api = tracker.run, tracker.storage, tracker.ikea_api
        self.api.pause = lambda: None
        self.api.fetch_stores = lambda c="de": STORES
        self.world = {}
        self.failing = set()

        def fetch_store(sid, lang="de"):
            if sid in self.failing:
                raise RuntimeError("timeout")
            return {"content": self.world.get(sid, []), "pages": 1}
        self.api.fetch_store = fetch_store
        self.clock = 0

    def tick(self):
        self.clock += 1
        self.run.now = lambda c=self.clock: f"2026-05-0{1 + c // 24}T{c % 24:02d}:00:00+00:00"
        rc = self.run.main(["--no-export"])
        db = self.storage.load_db()
        meta = json.loads((self.tmp / "docs/data/meta.json").read_text())
        return rc, db, meta

    def tearDown(self):
        shutil.rmtree(self.tmp)


class TestMerge(Base):
    def test_lifecycle(self):
        self.world = {"148": [group("148", "KALLAX", "802.758.87", 50.0,
                                    [offer("a", "1001", 35.0), offer("b", "1002", 35.0)])]}
        rc, db, meta = self.tick()
        self.assertEqual(rc, 0)
        self.assertEqual(len(db), 2, "zwei gleiche Regale = zwei Angebote")
        a = db["u:a"]
        self.assertEqual(a["discount_eur"], 15.0); self.assertEqual(a["discount_pct"], 30.0)
        self.assertEqual(a["article_number"], "80275887")
        self.assertEqual(a["store"], "Berlin-Lichtenberg")
        self.assertIn("#/berlinlichtenberg/1001", a["link"])

        # Wiederholter Abruf: nichts doppelt
        rc, db, meta = self.tick()
        self.assertEqual(len(db), 2)
        self.assertEqual(db["u:a"]["last_seen"], "2026-05-01T02:00:00+00:00", "last_seen rekonstruiert")
        raw = (self.tmp / "docs/data/current.json").read_text()
        self.assertNotIn("last_seen", raw, "unveraenderte Angebote ohne fluechtige Felder")

        # Markt faellt aus -> NICHT verschwunden
        self.failing = {"148"}
        for _ in range(3):
            rc, db, meta = self.tick()
        self.assertEqual(db["u:a"]["status"], "active")
        self.assertEqual(meta["last_run"]["stores_ok"], 1)

        # Markt leer trotz Bestand? Bestand 2 < Schwelle -> zaehlt als echt leer
        self.failing = set()
        self.world["148"][0]["offers"] = [offer("a", "1001", 29.0)]   # b weg, a billiger
        rc, db, meta = self.tick()
        self.assertEqual(db["u:b"]["status"], "active", "einmal fehlen reicht nicht")
        self.assertEqual(db["u:a"]["price"], 29.0)
        self.assertEqual(len(db["u:a"]["price_history"]), 2)
        rc, db, meta = self.tick()
        self.assertEqual(db["u:b"]["status"], "gone")
        self.assertTrue((self.tmp / "docs/data/archive").glob("*.json"))

        # b taucht wieder auf -> selber Datensatz
        self.world["148"][0]["offers"].append(offer("b", "1002", 35.0))
        rc, db, meta = self.tick()
        self.assertEqual(db["u:b"]["status"], "active")
        self.assertEqual(db["u:b"]["reappear_count"], 1)
        self.assertEqual(len(db), 2)

        ev = (self.tmp / f"docs/data/events/2026-05.csv").read_text()
        for t in ("new", "price_change", "gone", "reappeared"):
            self.assertIn(f",{t},", ev)

    def test_duplicates_in_response_and_fallback_key(self):
        o = {"offerNumber": "77", "price": 10}
        self.world = {"124": [group("124", "LACK", "00000001", 20.0, [o, dict(o)])]}
        rc, db, meta = self.tick()
        self.assertEqual(list(db), ["n:124:77"])
        self.assertIn("hannover+expopark/77", db["n:124:77"]["link"])

    def test_suspicious_empty_store(self):
        self.world = {"148": [group("148", "X", "1", 10.0, [offer(f"u{i}", str(i), 5.0) for i in range(15)])]}
        self.tick()
        self.world = {"148": []}
        for _ in range(3):
            rc, db, meta = self.tick()
        self.assertTrue(all(o["status"] == "active" for o in db.values()))
        self.assertIn("leer trotz Bestand", meta["last_run"]["errors"])

    def test_watch_first_run_silent_then_hits(self):
        import tracker.watch as w
        sent = []
        w.send_telegram = lambda text, *a, **k: sent.append(text)
        os.environ["TELEGRAM_BOT_TOKEN"] = "t"; os.environ["TELEGRAM_CHAT_ID"] = "c"
        try:
            self.world = {"148": [group("148", "KALLAX", "1", 100.0, [offer("a", "1", 70.0)])]}
            self.tick()
            self.assertEqual(sent, [], "erster Lauf still")
            self.world["148"][0]["offers"].append(offer("c", "3", 60.0))
            self.world["148"].append(group("148", "BILLY", "2", 100.0, [offer("d", "4", 10.0)]))
            self.tick()
            self.assertEqual(len(sent), 1); self.assertIn("KALLAX", sent[0])
            self.tick()
            self.assertEqual(len(sent), 1, "keine Doppelmeldung")
            self.world["148"][0]["offers"][1]["price"] = 50.0     # Preissenkung
            self.tick()
            self.assertEqual(len(sent), 2); self.assertIn("Preis gesenkt", sent[1])
        finally:
            del os.environ["TELEGRAM_BOT_TOKEN"], os.environ["TELEGRAM_CHAT_ID"]


class TestRules(unittest.TestCase):
    def test_matches(self):
        from tracker.watch import matches
        o = {"title": "MALM", "product_description": "Kommode mit 4 Schubladen, weiß", "offer_description": "",
             "article_numbers": ["80214546"], "article_number": "80214546", "store_id": "148",
             "store": "Berlin-Lichtenberg", "price": 60.0, "discount_pct": 40.0,
             "condition": "Gebraucht - wie neu", "reason_discount": "Kratzer an der Seite"}
        self.assertTrue(matches({"keywords": ["malm kommode"]}, o))
        self.assertTrue(matches({"keywords": ["weiss"]}, o), "Umlaut-Faltung")
        self.assertTrue(matches({"article_numbers": ["802.145.46"]}, o))
        self.assertFalse(matches({"keywords": ["malm"], "stores": ["Hamburg"]}, o))
        self.assertTrue(matches({"keywords": ["malm"], "stores": ["berlin"]}, o))
        self.assertFalse(matches({"keywords": ["malm"], "min_discount_pct": 50}, o))
        self.assertTrue(matches({"conditions": ["kratzer"]}, o))
        self.assertFalse(matches({"keywords": ["malm"], "exclude": ["schublade"]}, o))
        self.assertFalse(matches({"keywords": ["malm"], "enabled": False}, o))


if __name__ == "__main__":
    unittest.main()
