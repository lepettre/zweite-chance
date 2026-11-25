"""Verschluesseltes Handbuch (Datenstandard, Changelog, Regeln) im oeffentlichen Repository.

Schreiben geht OHNE Passwort (oeffentlicher Schluessel), lesen nur MIT Passwort:
  - config/handbuch.pub      oeffentlicher X25519-Schluessel (Klartext, unbedenklich)
  - config/handbuch.key.bin  privater Schluessel, mit ZC_PASSWORD verschluesselt
  - handbuch/<name>.md.enc   Texte, mit dem oeffentlichen Schluessel verschluesselt

  python -m tracker.docsec keys                 # einmalig (GitHub-Lauf): Schluesselpaar anlegen, falls keins da ist
  python -m tracker.docsec seal handbuch/X.md   # lokal: Klartext verschluesseln -> handbuch/X.md.enc, Klartext loeschen
  python -m tracker.docsec open handbuch/X.md.enc  # mit ZC_PASSWORD: Klartext ausgeben (zum Bearbeiten)
  python -m tracker.docsec publish OUT          # mit ZC_PASSWORD: alle Texte als OUT (wie die anderen Daten verschluesselt)
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from . import crypto

ROOT = Path(__file__).resolve().parent.parent
PUB, PRIV, DIR = ROOT / "config" / "handbuch.pub", ROOT / "config" / "handbuch.key.bin", ROOT / "handbuch"
MAGIC = b"ZCH1"


def _kdf(shared: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"zc-handbuch-v1", info=b"zc").derive(shared)


def seal_text(text: str, pub_b64: str) -> bytes:
    pub = X25519PublicKey.from_public_bytes(base64.b64decode(pub_b64))
    eph = X25519PrivateKey.generate()
    key = _kdf(eph.exchange(pub))
    iv = os.urandom(12)
    eph_pub = eph.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return MAGIC + eph_pub + iv + AESGCM(key).encrypt(iv, text.encode("utf-8"), None)


def open_text(blob: bytes, priv_raw: bytes) -> str:
    assert blob[:4] == MAGIC, "kein Handbuch-Format"
    priv = X25519PrivateKey.from_private_bytes(priv_raw)
    eph = X25519PublicKey.from_public_bytes(blob[4:36])
    return AESGCM(_kdf(priv.exchange(eph))).decrypt(blob[36:48], blob[48:], None).decode("utf-8")


def private_key() -> bytes:
    return base64.b64decode(crypto.open_(PRIV.read_bytes(), crypto.key_from_env())["key"])


def main(argv=None) -> int:
    a = (argv if argv is not None else sys.argv[1:]) or ["help"]
    cmd = a[0]
    if cmd == "keys":
        if PUB.exists() and PRIV.exists():
            print("[docsec] Schluessel vorhanden - nichts zu tun.")
            return 0
        k = X25519PrivateKey.generate()
        raw = k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        PRIV.write_bytes(crypto.seal({"key": base64.b64encode(raw).decode()}, crypto.key_from_env()))
        PUB.write_text(base64.b64encode(pub).decode() + "\n")
        print("[docsec] Schluesselpaar angelegt.")
        return 0
    if cmd == "seal":
        pub = PUB.read_text().strip()
        for f in a[1:]:
            p = Path(f)
            Path(str(p) + ".enc").write_bytes(seal_text(p.read_text(encoding="utf-8"), pub))
            p.unlink()                                  # Klartext nie im oeffentlichen Repository lassen
            print(f"[docsec] {p} -> {p}.enc")
        return 0
    if cmd == "open":
        print(open_text(Path(a[1]).read_bytes(), private_key()))
        return 0
    if cmd == "publish":
        priv = private_key()
        docs = {p.name[:-len(".md.enc")]: open_text(p.read_bytes(), priv) for p in sorted(DIR.glob("*.md.enc"))}
        out = Path(a[1])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(crypto.seal({"docs": docs}, crypto.key_from_env()))
        print(f"[docsec] {len(docs)} Texte -> {out}")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
