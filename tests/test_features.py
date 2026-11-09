import json
import os
import unittest
from datetime import datetime, timezone

from tests.test_tracker import Base, group, offer


class TestPackCrypto(unittest.TestCase):
    def test_roundtrip_and_wrong_key(self):
        from tracker import crypto
        from tracker.pack import pack_offers, unpack_offers
        from tracker.normalize import content_hash
        o = {"id": "u:abc", "offer_number": "7", "store_id": "148", "store": "Berlin-Lichtenberg", "title": "KALLAX",
             "product_description": "Regal", "offer_description": "", "article_number": "80275887",
             "article_numbers": ["80275887", "12345678"], "condition": "gut", "condition_code": "", "condition_description": "x",
             "reason_discount": "Kratzer", "additional_info": "", "image": "https://x/i.jpg", "status": "active",
             "first_seen": "2026-01-01T00:00:00+00:00", "last_seen": "2026-01-02T00:00:00+00:00", "gone_at": None,
             "price_history": [["2026-01-01T00:00:00+00:00", 50.0]], "price": 40.0, "original_price": 50.0,
             "reappear_count": 0, "missing_runs": 0}
        stores = {"148": {"id": "148", "name": "Berlin-Lichtenberg", "slug": "berlinlichtenberg"}}
        back = unpack_offers(pack_offers([o]), stores, {"148": "2026-01-09T00:00:00+00:00"})[0]
        self.assertEqual(back["article_numbers"], ["80275887", "12345678"])
        self.assertEqual(back["discount_pct"], 20.0)
        self.assertEqual(back["last_seen"], "2026-01-09T00:00:00+00:00", "aus Markt-Stand rekonstruiert")
        self.assertTrue(back["link"].endswith("#/berlinlichtenberg/7"))
        self.assertEqual(back["hash"], content_hash(back))
        key = crypto.derive_key("a")
        blob = crypto.seal({"x": 1}, key)
        self.assertEqual(crypto.open_(blob, key), {"x": 1})
        with self.assertRaises(Exception):
            crypto.open_(blob, crypto.derive_key("b"))


class TestFeatures(Base):
    def _capture(self):
        import tracker.watch as w
        sent = []
        w.send_telegram = lambda text, *a, **k: sent.append(text)
        os.environ["TELEGRAM_BOT_TOKEN"] = "t"; os.environ["TELEGRAM_CHAT_ID"] = "c"
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")])
        return sent

    def test_identical_items_one_message(self):
        sent = self._capture()
        self.world = {"148": [group("148", "BILLY", "2", 100.0, [offer("d", "4", 10.0)])]}
        self.tick()
        self.world["148"].append(group("148", "KALLAX", "1", 100.0,
                                       [offer("a", "1", 70.0), offer("b", "2", 65.0), offer("c", "3", 60.0)]))
        self.world["124"] = [group("124", "KALLAX", "1", 100.0, [offer("e", "9", 55.0)])]
        self.tick(); self.run.main(["--send-outbox"])
        self.assertEqual(len(sent), 1, "vier gleiche Artikel = eine Nachricht")
        self.assertIn("4× verfügbar", sent[0]); self.assertIn("Hannover", sent[0])

    def test_archive_retention(self):
        self.world = {"148": [group("148", "X", "1", 10.0, [offer("a", "1", 5.0), offer("b", "2", 5.0)])]}
        self.tick()
        self.world = {"148": [group("148", "X", "1", 10.0, [offer("b", "2", 5.0)])]}
        self.tick(); rc, db, meta = self.tick()
        self.assertEqual(db["u:a"]["status"], "gone")
        db["u:a"]["gone_at"] = "2026-05-01T01:00:00+00:00"
        self.storage.save_db(db, "2026-07-01T00:00:00+00:00", 30)
        self.assertNotIn("u:a", self.storage.load_db(), "aelter als archive_days wird verworfen")

    def test_min_gap_skips_second_start(self):
        self.world = {"148": [group("148", "X", "1", 10.0, [offer("a", "1", 5.0)])]}
        self.tick()
        st = self.storage.read_meta()
        st["updated"] = datetime.now(timezone.utc).isoformat()
        self.storage.write_bin("meta.bin", st)
        s = json.loads((self.tmp / "config/settings.json").read_text()); s["min_gap_minutes"] = 40
        (self.tmp / "config/settings.json").write_text(json.dumps(s))
        before = (self.tmp / "site/d/current.bin").read_bytes()
        self.assertEqual(self.run.main([]), 0)
        self.assertEqual((self.tmp / "site/d/current.bin").read_bytes(), before, "kein zweiter Abruf")


class TestBot(unittest.TestCase):
    def setUp(self):
        self.stores = [{"id": "1", "name": "Hamburg-Altona", "slug": "hamburgaltona"},
                       {"id": "2", "name": "Kiel", "slug": "kiel"}, {"id": "3", "name": "Hamburg-Moorfleet", "slug": "x"}]
        mk = lambda i, sid, title, price: {"id": i, "store_id": sid, "store": {"1": "Hamburg-Altona", "2": "Kiel", "3": "Hamburg-Moorfleet"}[sid],
             "title": title, "product_description": "Schublade, weiß", "offer_description": "", "article_number": "50503273",
             "article_numbers": ["50503273"], "condition": "gut", "reason_discount": "", "additional_info": "", "price": price,
             "original_price": 50.0, "discount_pct": 30.0, "status": "active", "first_seen": "2026-05-09T10:00:00+00:00",
             "link": "https://x/" + i}
        self.db = {"a": mk("a", "1", "KNIVSHULT", 20.0), "b": mk("b", "1", "KNIVSHULT", 25.0),
                   "c": mk("c", "2", "KNIVSHULT", 30.0), "d": mk("d", "3", "ALEX", 90.0)}
        self.meta = {"stores": self.stores, "updated": "2026-05-09T11:00:00+00:00", "active": 4,
                     "last_run": {"stores_ok": 3, "stores_total": 3}}
        self.now = datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)

    def test_parse_store_and_terms(self):
        from tracker.bot import parse
        cmd, terms, ids = parse("Was gibt es von Knivshult in Hamburg?", self.stores)
        self.assertEqual((cmd, terms, ids), ("suche", ["knivshult"], {"1", "3"}))

    def test_search_groups_identical(self):
        from tracker.bot import answer
        msg = answer("knivshult hamburg", self.db, self.meta, self.now)
        self.assertEqual(len(msg), 1)
        self.assertIn("2× ", msg[0]); self.assertNotIn("Kiel", msg[0]); self.assertNotIn("ALEX", msg[0])

    def test_article_number_new_stand(self):
        from tracker.bot import answer
        self.assertIn("Kiel", answer("505.032.73", self.db, self.meta, self.now)[0])
        self.assertIn("Neu", answer("neu kiel", self.db, self.meta, self.now)[0])
        self.assertIn("vor 60 Min.", answer("stand", self.db, self.meta, self.now)[0])
        self.assertIn("Nichts gefunden", answer("sofa", self.db, self.meta, self.now)[0])


if __name__ == "__main__":
    unittest.main()


class TestManage(unittest.TestCase):
    def test_merke_liste_vergiss(self):
        from unittest import mock
        from tracker import bot, watch
        store = {"rules": [], "groups": {}}

        def fake(method, body=None):
            if method == "PUT":
                store.update(body)
            return dict(store)
        meta = {"stores": [{"id": "1", "name": "Hamburg-Altona"}, {"id": "2", "name": "Kiel"}]}
        with mock.patch.object(watch, "_worker_request", fake):
            self.assertIn("angelegt", bot.answer("/merke Knivshult Hamburg bis 40", {}, meta)[0])
            self.assertEqual(store["rules"][0]["stores"], ["1"]); self.assertEqual(store["rules"][0]["max_price"], 40.0)
            self.assertIn("gibt es schon", bot.answer("/merke knivshult hamburg bis 40", {}, meta)[0])
            self.assertIn("Knivshult", bot.answer("/liste", {}, meta)[0])
            self.assertIn("gelöscht", bot.answer("/vergiss 1", {}, meta)[0])
            self.assertEqual(store["rules"], [])
        with mock.patch.object(watch, "_worker_request", lambda m, b=None: None):
            self.assertIn("nicht eingerichtet", bot.answer("/liste", {}, meta)[0])
