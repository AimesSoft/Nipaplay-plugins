#!/usr/bin/env python3
"""Sync & validate plugins.json from plugin source files.

Detects added / updated / deleted plugins via git diff and regenerates
the plugins.json index.  Designed to run in GitHub Actions after a PR
is merged, but can also be invoked locally.

Usage:
    # Auto-detect changes (CI mode)
    python scripts/sync_plugins_index.py

    # Specify changed files explicitly
    python scripts/sync_plugins_index.py plugins/my.filter/my.filter.js

    # Full rebuild — scan every plugin directory
    python scripts/sync_plugins_index.py --scan

    # Validate manifests only (no write)
    python scripts/sync_plugins_index.py --validate
"""

import json
import os
import re
import subprocess
import sys


PLUGINS_DIR = "plugins"
INDEX_FILE = "plugins.json"


def find_js_file(plugin_dir):
    """Return the first .js file in a plugin directory, or None."""
    for f in os.listdir(plugin_dir):
        if f.endswith(".js"):
            return f
    return None


def _js_obj_to_json(s):
    """Convert a JS object literal to valid JSON.

    Handles single quotes, unquoted keys, and string concatenation.
    """
    result = []
    i = 0
    n = len(s)

    while i < n:
        c = s[i]

        # ── string literal ────────────────────────────────────────
        if c == "'" or c == '"':
            quote = c
            parts = []
            while True:
                j = i + 1
                while j < n:
                    if s[j] == '\\' and j + 1 < n:
                        j += 2
                        continue
                    if s[j] == quote:
                        break
                    j += 1
                if j >= n:
                    parts.append(s[i:])
                    i = n
                    break
                parts.append(s[i + 1:j])  # content without quotes
                i = j + 1

                # Check for concatenation: whitespace + '+'
                while i < n and s[i] in (' ', '\t', '\n', '\r'):
                    i += 1
                if i < n and s[i] == '+':
                    i += 1
                    while i < n and s[i] in (' ', '\t', '\n', '\r'):
                        i += 1
                    if i < n and (s[i] == "'" or s[i] == '"'):
                        continue  # next string — keep merging
                    merged = "".join(parts)
                    result.append('"' + merged.replace('\\', '\\\\').replace('"', '\\"') + '"')
                    result.append(" + ")
                    break
                else:
                    merged = "".join(parts)
                    merged = merged.replace('\\', '\\\\').replace('"', '\\"')
                    merged = merged.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
                    result.append('"' + merged + '"')
                    break

        # ── unquoted key (word followed by ':') ───────────────────
        elif c.isalpha() or c == '_':
            j = i
            while j < n and (s[j].isalnum() or s[j] == '_'):
                j += 1
            k = j
            while k < n and s[k] in (' ', '\t'):
                k += 1
            if k < n and s[k] == ':':
                result.append('"' + s[i:j] + '"')
                i = j
            else:
                result.append(s[i:j])
                i = j

        # ── everything else ───────────────────────────────────────
        else:
            result.append(c)
            i += 1

    return "".join(result)


def parse_manifest(filepath):
    """Extract pluginManifest from a JS file and return it as a dict."""
    with open(filepath, encoding="utf-8") as fh:
        content = fh.read()

    # Locate `const pluginManifest = { ... };`
    match = re.search(
        r"(?:const|var|let)\s+pluginManifest\s*=\s*(\{.*?\})\s*;",
        content,
        re.DOTALL,
    )
    if not match:
        return None

    json_str = _js_obj_to_json(match.group(1))

    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        return None


def load_index():
    """Load plugins.json, returning a default structure if absent."""
    if os.path.exists(INDEX_FILE):
        with open(INDEX_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    return {"version": 1, "plugins": []}


def save_index(data):
    """Persist plugins.json with consistent formatting."""
    with open(INDEX_FILE, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def detect_changed_dirs(changed_files):
    """Derive the set of plugin directories that were touched."""
    dirs = set()
    for f in changed_files:
        parts = f.replace("\\", "/").split("/")
        if len(parts) >= 2 and parts[0] == "plugins":
            dirs.add(parts[1])
    return dirs


def build_entry(plugin_dir, js_file):
    """Parse a plugin manifest and return a plugins.json entry."""
    manifest = parse_manifest(os.path.join(PLUGINS_DIR, plugin_dir, js_file))
    if not manifest:
        return None
    return {
        "id": manifest.get("id", ""),
        "name": manifest.get("name", ""),
        "version": manifest.get("version", ""),
        "description": manifest.get("description", ""),
        "author": manifest.get("author", ""),
        "github": manifest.get("github", ""),
        "file": f"{PLUGINS_DIR}/{plugin_dir}/{js_file}",
    }


def validate_manifest(plugin_dir, js_file, existing_ids):
    """Validate a single plugin manifest.  Returns a list of error strings."""
    errors = []
    label = f"{plugin_dir}/{js_file}"
    filepath = os.path.join(PLUGINS_DIR, plugin_dir, js_file)

    if not os.path.isfile(filepath):
        errors.append(f"[{label}] file not found: {filepath}")
        return errors

    manifest = parse_manifest(filepath)

    if manifest is None:
        errors.append(f"[{label}] cannot parse pluginManifest — check syntax")
        return errors

    # Required fields
    for field in ("id", "name", "version"):
        val = manifest.get(field, "")
        if not isinstance(val, str) or not val.strip():
            errors.append(f"[{label}] '{field}' must be a non-empty string")

    plugin_id = manifest.get("id", "").strip()

    # ID must match directory name
    if plugin_id and plugin_id != plugin_dir:
        errors.append(
            f"[{label}] id '{plugin_id}' does not match directory name '{plugin_dir}'"
        )

    # ID uniqueness (against other plugins, not itself)
    if plugin_id and plugin_id in existing_ids and existing_ids[plugin_id] != plugin_dir:
        errors.append(
            f"[{label}] id '{plugin_id}' conflicts with existing plugin "
            f"in plugins/{existing_ids[plugin_id]}/"
        )

    return errors


def get_changed_plugin_dirs():
    """Return sorted list of plugin directories touched since HEAD~1."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD~1", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        changed_files = [
            l.strip()
            for l in result.stdout.strip().splitlines()
            if l.strip().startswith("plugins/")
        ]
    except subprocess.CalledProcessError:
        return []

    return sorted(detect_changed_dirs(changed_files))


def run_validate(changed_files=None):
    """Validate manifests for changed plugins.  Returns True if all pass."""
    if "--validate" in (changed_files or []):
        changed_files = [f for f in changed_files if f != "--validate"]

    if not changed_files:
        dirs = get_changed_plugin_dirs()
    else:
        dirs = sorted(detect_changed_dirs(changed_files))

    if not dirs:
        print("No plugin changes to validate.")
        return True

    # Build existing-id map from current index
    index_data = load_index()
    existing_ids = {}
    for p in index_data.get("plugins", []):
        pid = p.get("id", "")
        fpath = p.get("file", "")
        parts = fpath.split("/")
        if pid and len(parts) >= 2:
            existing_ids[pid] = parts[1]

    all_errors = []
    for d in dirs:
        dp = os.path.join(PLUGINS_DIR, d)
        if not os.path.isdir(dp):
            # Deletion — nothing to validate
            print(f"  {d}/ — deleted, skip")
            continue
        js = find_js_file(dp)
        if not js:
            all_errors.append(f"[{d}/] no .js file found")
            continue
        errs = validate_manifest(d, js, existing_ids)
        if errs:
            all_errors.extend(errs)
        else:
            manifest = parse_manifest(os.path.join(dp, js))
            print(f"  {d}/ — OK  ({manifest['id']} v{manifest['version']})")

    if all_errors:
        print("\nValidation failed:")
        for e in all_errors:
            print(f"  [FAIL] {e}")
        return False

    print("All manifests valid.")
    return True


# ── main ──────────────────────────────────────────────────────────────


def main():
    args = sys.argv[1:]

    # ── validate mode ────────────────────────────────────────────────
    if "--validate" in args:
        changed_files = [f for f in args if f != "--validate"]
        ok = run_validate(changed_files)
        sys.exit(0 if ok else 1)

    # ── sync mode (default) ──────────────────────────────────────────
    changed_files = args
    scan_mode = "--scan" in changed_files
    changed_files = [f for f in changed_files if f != "--scan"]

    index_data = load_index()
    existing = {p["id"]: p for p in index_data.get("plugins", [])}
    updated = dict(existing)

    if not changed_files and not scan_mode:
        # CI fallback: diff HEAD~1..HEAD for plugins/ changes
        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", "HEAD~1", "HEAD"],
                capture_output=True,
                text=True,
                check=True,
            )
            changed_files = [
                l.strip()
                for l in result.stdout.strip().splitlines()
                if l.strip().startswith("plugins/")
            ]
        except subprocess.CalledProcessError:
            scan_mode = True  # fallback to full scan

    if scan_mode:
        # Full rebuild: iterate every directory under plugins/
        if os.path.isdir(PLUGINS_DIR):
            for d in sorted(os.listdir(PLUGINS_DIR)):
                dp = os.path.join(PLUGINS_DIR, d)
                if not os.path.isdir(dp):
                    continue
                js = find_js_file(dp)
                if not js:
                    continue
                entry = build_entry(d, js)
                if entry:
                    updated[entry["id"]] = entry
        # Drop entries whose plugin directory no longer exists
        on_disk = set()
        if os.path.isdir(PLUGINS_DIR):
            for d in os.listdir(PLUGINS_DIR):
                dp = os.path.join(PLUGINS_DIR, d)
                if os.path.isdir(dp) and find_js_file(dp):
                    on_disk.add(d)
        for pid in list(updated):
            plugin_dir = updated[pid]["file"].split("/")[1] if "/" in updated[pid]["file"] else ""
            if plugin_dir and plugin_dir not in on_disk:
                del updated[pid]
    else:
        # Incremental: only touch directories that appeared in the diff
        changed_dirs = detect_changed_dirs(changed_files)

        if not changed_dirs:
            print("No plugin changes detected.")
            return

        for d in sorted(changed_dirs):
            dp = os.path.join(PLUGINS_DIR, d)
            if os.path.isdir(dp):
                js = find_js_file(dp)
                if js:
                    entry = build_entry(d, js)
                    if entry:
                        updated[entry["id"]] = entry
                        print(f"  upsert: {entry['id']}  ({entry['version']})")
                        continue
            # Directory gone or manifest unreadable → remove by directory
            for pid in list(updated):
                if updated[pid]["file"].startswith(f"{PLUGINS_DIR}/{d}/"):
                    del updated[pid]
                    print(f"  remove: {pid}")

    index_data["plugins"] = sorted(updated.values(), key=lambda p: p["id"])
    save_index(index_data)
    print(f"plugins.json updated — {len(index_data['plugins'])} plugin(s).")


if __name__ == "__main__":
    main()
