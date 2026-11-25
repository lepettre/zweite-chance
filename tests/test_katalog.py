import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

FIX = Path(__file__).parent / "fixtures"


def sample_items():
    from katalog import model
    page = json.loads((FIX / "plp_sample.json").read_text())["productListPage"]
    return [x for x in (model.parse_item(i) for i in page["productWindow"]) if x]


class TestModel(unittest.TestCase):
    def test_parse(self):
        items = {i["id"]: i for i in sample_items()}
        self.assertEqual(len(items), 4)
        sofa = items["s29490102"]
        self.assertEqual(sofa["price"], 1110.0); self.assertEqual(sofa["no"], "29490102"); self.assertEqual(sofa["type"], "SPR")
        self.assertTrue(sofa["slug"].endswith("s29490102"), sofa["slug"])
        kivik = items["s19470227"]
        self.assertEqual(kivik["prev"], 399.0); self.assertEqual(kivik["tag"], "NEW_LOWER_PRICE")
        self.assertIn("90584658", items)

    def test_parse_structure_and_variants(self):
        from katalog import model
        it = {"itemNo": "12345678", "itemType": "ART", "name": "STOCKHOLM 2025", "typeName": "Vase", "salesPrice": {"numeral": 19.99},
              "businessStructure": {"homeFurnishingBusinessName": "Decoration", "productAreaName": "Vases"},
              "gprDescription": {"numberOfVariants": 3, "variants": [{"id": "11111111"}, {"id": "22222222"}]}}
        r = model.parse_item(it)
        self.assertEqual((r["hfb"], r["pa"], r["nvar"], r["vars"]), ("Decoration", "Vases", 3, "11111111,22222222"))
        back = model.unpack(model.pack({r["id"]: {**r, "first_seen": "d", "last_seen": "d", "status": "active", "missing": 0, "ph": [["d", 19.99]], "log": []}}))
        self.assertEqual(back[r["id"]]["vars"], "11111111,22222222"); self.assertEqual(back[r["id"]]["nvar"], 3)

    def test_merge_lifecycle_never_deletes(self):
        from katalog import model
        db, items = {}, sample_items()
        st = model.merge(db, items, "2026-11-01", complete=True)
        self.assertEqual(st["new"], 4); self.assertEqual(len(db), 4)
        # Preis aendert sich
        cheaper = [dict(i, price=i["price"] - 10) if i["id"] == "90584658" else i for i in items]
        st = model.merge(db, cheaper, "2026-11-02", complete=True)
        self.assertEqual(st["price_change"], 1)
        self.assertEqual(db["90584658"]["ph"], [["2026-11-01", 549.0], ["2026-11-02", 539.0]])
        # unvollstaendiger Lauf zaehlt nichts als fehlend
        model.merge(db, [], "2026-11-03", complete=False)
        self.assertTrue(all(o["status"] == "active" and o["missing"] == 0 for o in db.values()))
        # drei vollstaendige Laeufe ohne Artikel -> gone, aber nichts wird geloescht
        for d in ("2026-11-04", "2026-11-05", "2026-11-06"):
            model.merge(db, [i for i in items if i["id"] != "30635533"], d, complete=True)
        self.assertEqual(db["30635533"]["status"], "gone"); self.assertEqual(len(db), 4)
        self.assertEqual(db["30635533"]["log"][-1], ["2026-11-06", "gone"])
        # taucht wieder auf
        st = model.merge(db, items, "2026-11-07", complete=True)
        self.assertEqual(st["back"], 1); self.assertEqual(db["30635533"]["status"], "active")
        self.assertEqual([x[1] for x in db["30635533"]["log"]], ["gone", "back"])

    def test_last_chance_logged(self):
        from katalog import model
        db, items = {}, sample_items()
        model.merge(db, items, "2026-11-01", True)
        flagged = [dict(i, last=1) if i["id"] == "90584658" else i for i in items]
        st = model.merge(db, flagged, "2026-11-02", True)
        self.assertEqual(st["last_chance"], 1); self.assertEqual(db["90584658"]["log"], [["2026-11-02", "last"]])

    def test_pack_roundtrip(self):
        from katalog import model
        db = {}
        model.merge(db, sample_items(), "2026-11-01", True)
        model.merge(db, [dict(i, price=i["price"] + 5) for i in sample_items()], "2026-11-02", True)
        back = model.unpack(model.pack(db))
        self.assertEqual(back, db)

    def test_sitemap_parser(self):
        from katalog import api
        text = ('<url><loc>https://www.ikea.com/de/de/p/knivshult-schublade-hoch-dunkelgrau-70600664/</loc></url>'
                '<url><loc>https://www.ikea.com/de/de/p/jaettebo-sofa-s29490102/</loc></url><url><loc>https://x/y</loc></url>')
        self.assertEqual(api.parse_sitemap(text), {"70600664": "knivshult-schublade-hoch-dunkelgrau-70600664", "s29490102": "jaettebo-sofa-s29490102"})


class TestRun(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        os.environ["TRACKER_ROOT"] = str(self.tmp); os.environ["KATALOG_DATA"] = str(self.tmp / "k"); os.environ["ZC_PASSWORD"] = "pw"
        import importlib
        import katalog.store, katalog.run
        importlib.reload(katalog.store); importlib.reload(katalog.run)
        self.run, self.store, self.api = katalog.run, katalog.store, katalog.api
        self.api.pause = lambda: None
        self.api.category_ids = lambda: ["1", "2"]
        self.pages = {"1": json.loads((FIX / "plp_sample.json").read_text())["productListPage"], "2": {"productWindow": []}}
        self.api.fetch_category = lambda k: self.pages[k]

    def tearDown(self):
        shutil.rmtree(self.tmp)
        os.environ.pop("KATALOG_DATA", None)

    def test_run_stores_encrypted_and_never_shrinks(self):
        self.assertEqual(self.run.main([]), 0)
        raw = (self.tmp / "k" / "items.bin").read_bytes()
        self.assertTrue(raw.startswith(b"ZC1")); self.assertNotIn(b"KIVIK", raw)
        db = self.store.load_db(); self.assertEqual(len(db), 4)
        meta = self.store.read_bin("meta.bin"); self.assertEqual(meta["last_run"]["total"], 4)
        # Kategorie faellt aus -> unvollstaendig, nichts geht verloren
        self.api.fetch_category = lambda k: (_ for _ in ()).throw(RuntimeError("timeout"))
        self.run.main([])
        self.assertEqual(len(self.store.load_db()), 4)
        self.assertEqual(self.store.read_bin("meta.bin")["last_run"]["complete"], 0)

    def test_gaps_and_fill(self):
        self.run.main([])
        db = self.store.load_db()
        in_map = {"90584658": "x-90584658", "70600664": "knivshult-schublade-hoch-dunkelgrau-70600664", "s11112222": "set-s11112222", "s33334444": "kaputt-s33334444"}
        g = self.run.gaps(db, in_map)
        self.assertEqual(g["only_sitemap"], 3); self.assertGreaterEqual(g["only_list"], 3)

        def fake(art):
            if art == "s33334444":
                raise FileNotFoundError(art)
            return {"name": "KNIVSHULT", "typeName": "Schublade hoch", "priceNumeral": 89, "pipUrl": f"https://www.ikea.com/de/de/p/knivshult-{art}/",
                    "mainImage": {"url": "https://www.ikea.com/de/de/images/products/k.jpg"}}
        self.api.fetch_product_json = fake
        n = self.run.fill(db, g["only_sitemap_ids"], in_map, "2026-11-02", 5)
        self.assertEqual(n, 3)
        self.assertEqual(db["70600664"]["price"], 89); self.assertEqual(db["70600664"]["status"], "active")
        self.assertEqual(db["s11112222"]["status"], "active", "auch Sets werden nachgeladen")
        self.assertEqual(db["s11112222"]["slug"], "knivshult-s11112222")
        self.assertEqual(db["s33334444"]["status"], "stub", "nicht ladbar: Platzhalter, wird nicht jeden Tag neu versucht")
        self.assertEqual(self.run.fill(db, g["only_sitemap_ids"], in_map, "2026-11-03", 5), 0)

    def test_daily_fill_uses_saved_gaps(self):
        self.run.main([])
        in_map = {"70600664": "a-70600664", "s11112222": "b-s11112222"}
        self.run.sitemap_ids = lambda: in_map
        self.api.fetch_product_json = lambda art: {"name": "X", "typeName": "t", "priceNumeral": 5, "pipUrl": f"https://www.ikea.com/de/de/p/x-{art}/", "mainImage": {"url": ""}}
        self.run.main(["--sitemap"])                       # speichert alle Luecken
        self.assertEqual(set(self.store.read_bin("gaps.bin")["map"]), set(in_map))
        self.run.main(["--fill", "1"])                     # ohne Sitemap: aus gespeicherten Luecken
        db = self.store.load_db()
        self.assertEqual(sum(1 for i in in_map if i in db), 1)
        self.run.main(["--fill", "5"])
        self.assertEqual(sum(1 for i in in_map if i in self.store.load_db()), 2)


class TestSortiment(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        os.environ["TRACKER_ROOT"] = str(self.tmp); os.environ["KATALOG_DATA"] = str(self.tmp / "k"); os.environ["ZC_PASSWORD"] = "pw"
        import importlib
        import katalog.store, katalog.sortiment, katalog.run
        importlib.reload(katalog.store); importlib.reload(katalog.sortiment)
        self.s, self.store, self.api = katalog.sortiment, katalog.store, katalog.api
        self.api.pause = lambda: None
        from katalog import model
        db = {}
        model.merge(db, sample_items(), "2026-11-01", True)
        self.store.save_db(db)
        self.api.stores = lambda: [{"id": "066", "name": "Augsburg", "lat": 48.4, "lng": 10.8}, {"id": "324", "name": "Berlin", "lat": 52.5, "lng": 13.5}]
        self.in_range = {"066": {"90584658", "29490102"}, "324": {"90584658", "30635533", "19470227"}}

        def avail(store_id, nos):
            out = []
            for n in nos:
                typ = "SPR" if n in ("29490102", "19470227") else "ART"
                out.append({"itemKey": {"itemNo": n, "itemType": typ}, "buyingOption": {"cashCarry": {"range": {"inRange": n in self.in_range[store_id]},
                            "availability": {"quantity": 3 if n == "90584658" else 0}}}})
            return out
        self.api.availabilities = avail

    def tearDown(self):
        shutil.rmtree(self.tmp); os.environ.pop("KATALOG_DATA", None)

    def test_bits_roundtrip(self):
        flags = [True, False, True, True, False, False, False, False, True]
        self.assertEqual(self.s.from_bits(self.s.to_bits(flags), len(flags)), flags)

    def test_sweep_and_append_only_ids(self):
        self.assertEqual(self.s.main([]), 0)
        d = self.store.read_bin("range.bin")
        ids = d["ids"]; self.assertEqual(len(ids), 4)
        r066 = dict(zip(ids, self.s.from_bits(d["range"]["066"], len(ids))))
        self.assertEqual({k for k, v in r066.items() if v}, {"90584658", "s29490102"})
        stock = dict(zip(ids, self.s.from_bits(d["stock"]["324"], len(ids))))
        self.assertTrue(stock["90584658"]); self.assertFalse(stock["30635533"])
        # neuer Artikel: Liste waechst nur am Ende, bestehende Positionen bleiben
        from katalog import model
        db = self.store.load_db()
        model.merge(db, [dict(sample_items()[0], id="11111111", no="11111111", type="ART")], "2026-11-02", False)
        self.store.save_db(db)
        self.s.main(["--stores", "1"])
        ids2 = self.store.read_bin("range.bin")["ids"]
        self.assertEqual(ids2[:4], ids); self.assertEqual(len(ids2), 5)
        # Momentaufnahmen fuer die Zeitmaschine bleiben als eigene Dateien erhalten
        d2 = self.store.read_bin("range.bin")
        self.assertTrue(d2["snapshots"]); self.assertIsNotNone(self.store.read_bin(f"range-{d2['snapshots'][-1]}.bin"))

    def test_oldest_measurement_first(self):
        self.s.main(["--stores", "1"])
        d = self.store.read_bin("range.bin")
        self.assertEqual(sum(1 for s in d["stores"] if s.get("day")), 1)
        self.s.main(["--stores", "1"])
        self.assertEqual(sum(1 for s in self.store.read_bin("range.bin")["stores"] if s.get("day")), 2, "zweiter Lauf nimmt den anderen Markt")


class TestDetails(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        os.environ["TRACKER_ROOT"] = str(self.tmp); os.environ["KATALOG_DATA"] = str(self.tmp / "k"); os.environ["ZC_PASSWORD"] = "pw"
        import importlib
        import katalog.store, katalog.details
        importlib.reload(katalog.store); importlib.reload(katalog.details)
        self.d, self.store, self.api = katalog.details, katalog.store, katalog.api
        self.api.pause = lambda: None
        from katalog import model
        db = {}
        model.merge(db, sample_items(), "2026-11-01", True)
        self.store.save_db(db)
        self.page = (FIX / "pip_sample.html").read_text(encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp); os.environ.pop("KATALOG_DATA", None)

    def test_parse_page(self):
        r = self.d.parse_page(self.page)
        self.assertEqual(r["designer"], "Gillis Lundgren"); self.assertIn("BILLY", r["desc"])
        self.assertEqual(r["material"], "Holz (inkl. Verbundmaterial)"); self.assertEqual((r["w"], r["h"], r["d"]), ("80 cm", "202 cm", "28 cm"))
        self.assertTrue(r["imgs"].count("|") >= 1)

    def test_pack_roundtrip_and_pick(self):
        rows = {"a": {**self.d.parse_page(self.page), "day": "2026-11-01", "ok": "1"}, "b": {"day": "2026-01-01", "ok": "1"}}
        self.assertEqual(self.d.unpack(self.d.pack(rows))["a"]["designer"], "Gillis Lundgren")
        db = self.store.load_db()
        have = {k: {"day": "2026-11-20"} for k in list(db)[:2]}
        todo = self.d.pick(db, have, 10, 180, "2026-11-24")
        self.assertEqual(set(todo), set(db) - set(have), "erst Artikel ohne Details")
        old = {k: {"day": "2026-01-01"} for k in db}
        self.assertEqual(len(self.d.pick(db, old, 2, 180, "2026-11-24")), 2, "danach veraltete")

    def test_run_budget_and_missing_page(self):
        calls = []

        def fake(url, **kw):
            calls.append(url)
            if "knivshult" in url:
                raise FileNotFoundError(url)
            return self.page.encode()
        self.api.get = fake
        self.assertEqual(self.d.main(["--limit", "3"]), 0)
        have = self.d.unpack(self.store.read_bin("details.bin"))
        self.assertEqual(len(have), 3); self.assertEqual(len(calls), 3)
        self.assertTrue(any(r["designer"] == "Gillis Lundgren" for r in have.values()))


class TestFacets(unittest.TestCase):
    def test_facets(self):
        from katalog import details
        f = details.facets({"a": {"designer": "X", "material": "Holz (inkl. Verbundmaterial)"}, "b": {"designer": "", "material": "holz, Metall"},
                            "c": {"designer": "X", "material": "Stahl"}, "d": {"designer": "Y"}})
        self.assertEqual(f["designer"], {"X": ["a", "c"], "Y": ["d"]}); self.assertEqual(f["n"], 4)
        self.assertEqual(f["material"]["Holz"], ["a", "b"]); self.assertEqual(f["material"]["Stahl"], ["c"])
