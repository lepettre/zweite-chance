import unittest


class TestSubs(unittest.TestCase):
    def setUp(self):
        from tracker import subs
        self.subs = subs
        self.db = {
            "1": {"id": "1", "no": "1", "name": "STOCKHOLM 2025", "kind": "Vase", "slug": "s-1", "first_seen": "2026-11-20", "status": "active", "log": [], "ph": [["2026-11-20", 20.0]], "price": 20.0},
            "2": {"id": "2", "no": "2", "name": "STOCKHOLM", "kind": "Tisch", "slug": "s-2", "first_seen": "2026-11-01", "status": "active", "log": [], "ph": [["2026-11-01", 100.0], ["2026-11-20", 80.0]], "price": 80.0},
            "3": {"id": "3", "no": "3", "name": "TERTIAL", "kind": "Leuchte", "slug": "s-3", "first_seen": "2026-11-01", "status": "gone", "log": [["2026-11-20", "gone"]], "ph": [["2026-11-01", 15.0]], "price": 15.0},
        }
        self.des = {"H Preutz/W Braasch": {"3"}}
        subs._CAT = {"db": self.db, "by_no": {o["no"]: o for o in self.db.values()}, "designer": self.des}

    def tearDown(self):
        self.subs._CAT = None

    def test_kollektion_ist_nicht_serie(self):
        self.assertTrue(self.subs.item_matches({"k": "koll", "v": "STOCKHOLM 2025"}, self.db["1"], self.des))
        self.assertFalse(self.subs.item_matches({"k": "serie", "v": "STOCKHOLM"}, self.db["1"], self.des))
        self.assertTrue(self.subs.item_matches({"k": "serie", "v": "STOCKHOLM"}, self.db["2"], self.des))

    def test_folgen_regel_trifft_nicht_alles(self):
        from tracker import watch
        rule = {"name": "Folgen", "sub": {"k": "des", "v": "Henrik Preutz", "raw": ["H Preutz/W Braasch"]}, "stores": ["066"]}
        self.assertTrue(watch.matches(rule, {"article_number": "3", "store_id": "066", "title": "TERTIAL"}))
        self.assertFalse(watch.matches(rule, {"article_number": "3", "store_id": "999", "title": "TERTIAL"}), "anderer Markt")
        self.assertFalse(watch.matches(rule, {"article_number": "1", "store_id": "066", "title": "STOCKHOLM 2025"}))

    def test_tagesmeldungen_einmalig(self):
        rules = [{"id": "a", "sub": {"k": "serie", "v": "STOCKHOLM"}}, {"id": "b", "sub": {"k": "des", "v": "Henrik Preutz", "raw": ["H Preutz/W Braasch"]}}]
        keys = {}
        msgs = self.subs.catalog_messages(rules, self.db, "2026-11-20", self.des, keys)
        self.assertEqual(len(msgs), 2)
        self.assertIn("Preis gesenkt", msgs[0]); self.assertIn("ausgelistet", msgs[1])
        self.assertEqual(self.subs.catalog_messages(rules, self.db, "2026-11-20", self.des, keys), [], "nicht doppelt")

    def test_anlernphase_kein_neu(self):
        ev = lambda b: [k for k, o in self.subs.catalog_events(self.db, "2026-11-20", b) if k == "neu"]
        self.assertEqual(ev(""), [], "Anlernphase: nichts ist neu")
        self.assertEqual(ev("2026-11-20"), [], "bis einschliesslich Ende der Anlernphase Startbestand")
        self.assertEqual(len(ev("2026-11-10")), 1, "danach neu")


class TestRuleKeys(unittest.TestCase):
    def test_folgen_und_filter_keine_duplikate(self):
        from tracker import watch
        rules = [{"sub": {"k": "des", "v": "A"}}, {"sub": {"k": "serie", "v": "B"}}, {"ui": {"bereich": ["X"]}}, {"ui": {"bereich": ["Y"]}}]
        self.assertEqual(len(watch.dedupe_rules(rules)), 4)


if __name__ == "__main__":
    unittest.main()


class TestHandbuch(unittest.TestCase):
    def test_schreiben_ohne_passwort_lesen_mit(self):
        import base64
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
        from tracker import docsec
        k = X25519PrivateKey.generate()
        raw = k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        pub = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        blob = docsec.seal_text("Datenstandard äöü", pub)
        self.assertNotIn(b"Datenstandard", blob)
        self.assertEqual(docsec.open_text(blob, raw), "Datenstandard äöü")


class TestHandbuchReihenfolge(unittest.TestCase):
    def test_ergaenzungen_vorne(self):
        import base64, os, tempfile
        from pathlib import Path
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
        from tracker import docsec, crypto
        os.environ["ZC_PASSWORD"] = "pw"
        k = X25519PrivateKey.generate()
        raw = k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        pub = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        tmp = Path(tempfile.mkdtemp())
        docsec.DIR, docsec.PRIV = tmp, tmp / "key.bin"
        docsec.PRIV.write_bytes(crypto.seal({"key": base64.b64encode(raw).decode()}, crypto.key_from_env()))
        for name, text in [("Changelog", "## 2.15"), ("Changelog+2.16", "## 2.16"), ("Changelog+2.17", "## 2.17")]:
            (tmp / f"{name}.md.enc").write_bytes(docsec.seal_text(text, pub))
        docsec.main(["publish", str(tmp / "out.bin")])
        out = crypto.open_((tmp / "out.bin").read_bytes(), crypto.key_from_env())["docs"]["Changelog"]
        self.assertEqual(out, "## 2.17\n\n## 2.16\n\n## 2.15")
