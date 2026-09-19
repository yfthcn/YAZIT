#!/usr/bin/env python3
"""
YAZIT build helper.
Creates two zip packages:
  - yazit-chrome.zip  (Chrome / Edge / Brave — uses service_worker)
  - yazit-firefox.zip (Firefox 140+ — uses background.scripts)

Run from the project root:
  python3 build.py              # the two store zips
  python3 build.py --unpacked   # + dist/firefox-unpacked/ for web-ext lint
                                #   (what `npm run lint:ext` calls)
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

# Force UTF-8 stdout on Windows so the ✓ status glyph below doesn't crash
# on terminals using cp1252 (Python 3.14 default behavior).
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.resolve()
DIST = ROOT / "dist"

# What ships, named explicitly. This used to be a blacklist of directories and
# a single "*.md" glob, which meant every directory nobody had thought of went
# to the stores: a scratch folder, a screenshots dump, a key file, an editor's
# cache. That is not hypothetical — a __pycache__/ created while auditing this
# very script showed up in the package listing. A blacklist can only exclude
# the mistakes someone already imagined; this list can only include what is
# named. Adding a file to the extension now means adding it here, and the
# build says so out loud rather than silently shipping or silently skipping.
PACKAGE_FILES = {
    "background.js",
    "common.js",
    "common-ui.js",
    "content.js",
    "options.html",
    "options.js",
    "popup.html",
    "popup.js",
    "theme.js",
    "README.md",
    "LICENSE",
}
PACKAGE_DIRS = {"icons", "_locales"}

# Everything present in the project root that is deliberately NOT packaged.
# Kept as an explicit set so an unknown name is a hard error instead of a
# silent skip — an unpackaged file is usually one someone forgot to add.
KNOWN_UNPACKAGED = {
    "manifest.json",     # injected per browser, see build_package
    "build.py", "package.json", "package-lock.json", "jsconfig.json",
    "tsconfig.json", "CHANGELOG.md", "CONTRIBUTING.md",
    "dist", "docs", "node_modules", "test", "types",
    "yazit.zip", "yazit.xpi", "Thumbs.db",
}

def load_manifest():
    with open(ROOT / "manifest.json", encoding="utf-8") as f:
        return json.load(f)

def write_manifest(path, manifest):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

def files_to_include():
    """Yield relative paths of files to include, from the whitelist above.

    Raises if the whitelist and the working tree disagree, in either
    direction: a named file that is missing, or a root entry that is neither
    packaged nor listed as deliberately excluded.
    """
    missing = sorted(n for n in PACKAGE_FILES if not (ROOT / n).is_file())
    missing += sorted(n + "/" for n in PACKAGE_DIRS if not (ROOT / n).is_dir())
    if missing:
        sys.exit("build.py: declared in PACKAGE_FILES/PACKAGE_DIRS but not found: " + ", ".join(missing))

    unknown = sorted(
        e.name for e in ROOT.iterdir()
        if not e.name.startswith(".")
        and e.name not in PACKAGE_FILES
        and e.name not in PACKAGE_DIRS
        and e.name not in KNOWN_UNPACKAGED
    )
    if unknown:
        sys.exit(
            "build.py: unknown entries in the project root: " + ", ".join(unknown) +
            "\n  Add each to PACKAGE_FILES/PACKAGE_DIRS to ship it, or to "
            "KNOWN_UNPACKAGED to keep it out. Refusing to guess."
        )

    for name in sorted(PACKAGE_FILES):
        yield Path(name)
    for dname in sorted(PACKAGE_DIRS):
        for path in sorted((ROOT / dname).rglob("*")):
            if path.is_file() and not path.name.startswith("."):
                yield path.relative_to(ROOT)

def build_package(kind, transform_manifest, unpacked=False):
    DIST.mkdir(exist_ok=True)
    zip_path = DIST / f"yazit-{kind}.zip"

    manifest = load_manifest()
    manifest = transform_manifest(manifest)
    manifest_json = json.dumps(manifest, indent=2, ensure_ascii=False)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        # Write customized manifest first (at root)
        z.writestr("manifest.json", manifest_json)
        # Then all other files
        for rel in files_to_include():
            z.write(ROOT / rel, str(rel))

    # Unpacked copy — only with --unpacked (`npm run lint:ext`): web-ext lint
    # needs a directory, a release build doesn't.
    if unpacked:
        udir = DIST / f"{kind}-unpacked"
        udir.mkdir(parents=True, exist_ok=True)
        (udir / "manifest.json").write_text(manifest_json, encoding="utf-8")
        for rel in files_to_include():
            dest = udir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / rel, dest)
        print(f"  ✓ {udir.relative_to(ROOT)}/  (unpacked, for web-ext lint)")

    print(f"  ✓ {zip_path.relative_to(ROOT)}  ({zip_path.stat().st_size // 1024} KB)")
    return zip_path

def chrome_manifest(m):
    """Chrome/Edge: MV3 standard. Uses service_worker.
    Removes Firefox-specific fields to avoid 'unrecognized key' warnings."""
    m.pop("browser_specific_settings", None)
    m["background"] = {"service_worker": "background.js"}
    return m

def firefox_manifest(m):
    """Firefox 140+: Uses background.scripts with explicit common.js load.
    Drops Chrome-only service_worker to avoid AMO warning.
    strict_min_version is the source manifest's source of truth (140.0)."""
    m["background"] = {"scripts": ["common.js", "common-ui.js", "background.js"]}
    # id / strict_min_version / data_collection_permissions come from the
    # source manifest. Only the Android minimum is added here (Firefox for
    # Android 142+ supports data_collection_permissions).
    bss = m.setdefault("browser_specific_settings", {})
    bss.setdefault("gecko_android", {})["strict_min_version"] = "142.0"
    return m

def main():
    unknown = [a for a in sys.argv[1:] if a != "--unpacked"]
    if unknown:
        sys.exit(f"build.py: unknown option(s): {' '.join(unknown)}\nusage: python3 build.py [--unpacked]")
    unpacked = "--unpacked" in sys.argv[1:]
    if DIST.exists():
        shutil.rmtree(DIST)
    print("Building YAZIT packages...\n")
    build_package("chrome", chrome_manifest)
    build_package("firefox", firefox_manifest, unpacked=unpacked)
    print(f"\nDone. Output in {DIST.relative_to(ROOT)}/")

if __name__ == "__main__":
    main()
