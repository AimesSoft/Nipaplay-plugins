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

    # Validate every plugin (used by CI)
    python scripts/sync_plugins_index.py --validate --scan
"""

import json
import os
import re
import subprocess
import sys
from urllib.parse import urlparse


PLUGINS_DIR = "plugins"
INDEX_FILE = "plugins.json"
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9._-]+$")
SHA256_RE = re.compile(r"^[A-Fa-f0-9]{64}$")
SUPPORTED_PERMISSIONS = {
    "player.control",
    "danmaku.modify",
    "danmaku.renderer",
    "script.external",
    "library.read",
    "library.write",
    "ui.dialog",
    "settings.read",
    "settings.modify",
    "storage",
    "system.override",
}
SUPPORTED_RENDERER_PLATFORMS = {"android", "ios"}
SUPPORTED_RENDERER_API_VERSION = 1


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


def _remove_trailing_commas(s):
    """Remove JS trailing commas without touching string contents."""
    result = []
    i = 0
    quote = None
    escaped = False
    while i < len(s):
        c = s[i]
        if quote is not None:
            result.append(c)
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == quote:
                quote = None
            i += 1
            continue
        if c in ("'", '"'):
            quote = c
            result.append(c)
            i += 1
            continue
        if c == ",":
            j = i + 1
            while j < len(s) and s[j].isspace():
                j += 1
            if j < len(s) and s[j] in ("}", "]"):
                i += 1
                continue
        result.append(c)
        i += 1
    return "".join(result)


def _balanced_expression(content, start, opening, closing):
    """Return a balanced JS expression while ignoring strings/comments."""
    if start >= len(content) or content[start] != opening:
        return None
    depth = 0
    quote = None
    escaped = False
    line_comment = False
    block_comment = False
    i = start
    while i < len(content):
        c = content[i]
        next_c = content[i + 1] if i + 1 < len(content) else ""
        if line_comment:
            if c in "\r\n":
                line_comment = False
            i += 1
            continue
        if block_comment:
            if c == "*" and next_c == "/":
                block_comment = False
                i += 2
            else:
                i += 1
            continue
        if quote is not None:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == quote:
                quote = None
            i += 1
            continue
        if c == "/" and next_c == "/":
            line_comment = True
            i += 2
            continue
        if c == "/" and next_c == "*":
            block_comment = True
            i += 2
            continue
        if c in ("'", '"', "`"):
            quote = c
            i += 1
            continue
        if c == opening:
            depth += 1
        elif c == closing:
            depth -= 1
            if depth == 0:
                return content[start:i + 1]
        i += 1
    return None


def _find_property(object_source, name):
    match = re.search(
        rf"(?:^|[,{{])\s*(?:{re.escape(name)}|['\"]{re.escape(name)}['\"])\s*:\s*",
        object_source,
    )
    return match.end() if match else None


def _read_string_property(object_source, name):
    start = _find_property(object_source, name)
    if start is None:
        return None
    if object_source.startswith("String.raw", start):
        start += len("String.raw")
        while start < len(object_source) and object_source[start].isspace():
            start += 1
    if start >= len(object_source) or object_source[start] not in ("'", '"', "`"):
        raise ValueError(f"'{name}' must be a string")
    quote = object_source[start]
    chars = []
    escaped = False
    i = start + 1
    while i < len(object_source):
        c = object_source[i]
        if escaped:
            chars.append(c)
            escaped = False
        elif c == "\\":
            chars.append(c)
            escaped = True
        elif c == quote:
            return "".join(chars)
        else:
            chars.append(c)
        i += 1
    raise ValueError(f"unterminated '{name}' string")


def _read_int_property(object_source, name, default=None):
    start = _find_property(object_source, name)
    if start is None:
        return default
    match = re.match(r"-?\d+", object_source[start:])
    if not match:
        raise ValueError(f"'{name}' must be an integer")
    return int(match.group(0))


def _read_string_array_property(object_source, name, default=None):
    start = _find_property(object_source, name)
    if start is None:
        return default
    while start < len(object_source) and object_source[start].isspace():
        start += 1
    expression = _balanced_expression(object_source, start, "[", "]")
    if expression is None:
        raise ValueError(f"'{name}' must be an array")
    try:
        value = json.loads(_remove_trailing_commas(_js_obj_to_json(expression)))
    except json.JSONDecodeError as error:
        raise ValueError(f"'{name}' must be a string array") from error
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError(f"'{name}' must be a string array")
    return value


def parse_danmaku_renderers(filepath):
    """Statically parse renderer declarations without executing plugin code."""
    with open(filepath, encoding="utf-8") as fh:
        content = fh.read()
    match = re.search(
        r"(?:const|var|let)\s+pluginDanmakuRenderers\s*=\s*",
        content,
    )
    if not match:
        return []
    start = match.end()
    while start < len(content) and content[start].isspace():
        start += 1
    array_source = _balanced_expression(content, start, "[", "]")
    if array_source is None:
        raise ValueError("pluginDanmakuRenderers must be an array literal")

    renderers = []
    i = 1
    while i < len(array_source) - 1:
        while i < len(array_source) - 1 and (
            array_source[i].isspace() or array_source[i] == ","
        ):
            i += 1
        if i >= len(array_source) - 1:
            break
        if array_source[i] != "{":
            raise ValueError("pluginDanmakuRenderers items must be object literals")
        object_source = _balanced_expression(array_source, i, "{", "}")
        if object_source is None:
            raise ValueError("unterminated renderer declaration")
        renderers.append({
            "id": _read_string_property(object_source, "id"),
            "name": _read_string_property(object_source, "name"),
            "description": _read_string_property(object_source, "description"),
            "apiVersion": _read_int_property(
                object_source, "apiVersion", SUPPORTED_RENDERER_API_VERSION
            ),
            "platforms": _read_string_array_property(
                object_source, "platforms", []
            ),
            "requires": _read_string_array_property(
                object_source, "requires", None
            ),
            "bootstrap": _read_string_property(object_source, "bootstrap"),
        })
        i += len(object_source)
    return renderers


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

    json_str = _remove_trailing_commas(_js_obj_to_json(match.group(1)))

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
        "minHostVersion": manifest.get("minHostVersion", ""),
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
    for field in ("id", "name", "version", "minHostVersion"):
        val = manifest.get(field, "")
        if not isinstance(val, str) or not val.strip():
            errors.append(f"[{label}] '{field}' must be a non-empty string")

    plugin_id = manifest.get("id", "").strip()

    if plugin_id and not IDENTIFIER_RE.fullmatch(plugin_id):
        errors.append(
            f"[{label}] 'id' may contain only letters, numbers, '.', '_' and '-'"
        )

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

    permissions = manifest.get("permissions", [])
    if not isinstance(permissions, list) or any(
        not isinstance(permission, str) for permission in permissions
    ):
        errors.append(f"[{label}] 'permissions' must be a string array")
        permissions = []
    else:
        unknown_permissions = sorted(set(permissions) - SUPPORTED_PERMISSIONS)
        for permission in unknown_permissions:
            errors.append(f"[{label}] unknown permission '{permission}'")

    external_ids = set()
    external_urls = set()
    requires = manifest.get("requires", [])
    if not isinstance(requires, list):
        errors.append(f"[{label}] pluginManifest.requires must be an array")
        requires = []
    for index, item in enumerate(requires):
        item_label = f"{label}:pluginManifest.requires[{index}]"
        if not isinstance(item, dict):
            errors.append(f"[{item_label}] must be an object")
            continue
        external_id = item.get("id", f"require{index}")
        if not isinstance(external_id, str) or not IDENTIFIER_RE.fullmatch(external_id):
            errors.append(f"[{item_label}] invalid external script id")
        elif external_id in external_ids:
            errors.append(f"[{item_label}] duplicate external script id '{external_id}'")
        else:
            external_ids.add(external_id)
        url = item.get("url", "")
        parsed_url = urlparse(url) if isinstance(url, str) else None
        if parsed_url is None or parsed_url.scheme != "https" or not parsed_url.netloc:
            errors.append(f"[{item_label}] url must be an absolute HTTPS URL")
        elif url in external_urls:
            errors.append(f"[{item_label}] duplicate external script URL '{url}'")
        else:
            external_urls.add(url)
        digest = item.get("sha256", "")
        if digest is not None and digest != "" and (
            not isinstance(digest, str) or not SHA256_RE.fullmatch(digest)
        ):
            errors.append(f"[{item_label}] sha256 must be 64 hexadecimal characters")

    if requires and "script.external" not in permissions:
        errors.append(
            f"[{label}] pluginManifest.requires needs permission 'script.external'"
        )

    try:
        renderers = parse_danmaku_renderers(filepath)
    except ValueError as error:
        errors.append(f"[{label}] invalid pluginDanmakuRenderers: {error}")
        renderers = []

    if renderers:
        for permission in ("danmaku.renderer", "script.external"):
            if permission not in permissions:
                errors.append(
                    f"[{label}] pluginDanmakuRenderers needs permission '{permission}'"
                )

    renderer_ids = set()
    for index, renderer in enumerate(renderers):
        renderer_label = f"{label}:pluginDanmakuRenderers[{index}]"
        renderer_id = renderer["id"]
        if not renderer_id or not IDENTIFIER_RE.fullmatch(renderer_id):
            errors.append(f"[{renderer_label}] invalid renderer id")
        elif renderer_id in renderer_ids:
            errors.append(f"[{renderer_label}] duplicate renderer id '{renderer_id}'")
        else:
            renderer_ids.add(renderer_id)
        if not renderer["name"] or not renderer["name"].strip():
            errors.append(f"[{renderer_label}] 'name' must be a non-empty string")
        if not renderer["bootstrap"] or not renderer["bootstrap"].strip():
            errors.append(f"[{renderer_label}] 'bootstrap' must be a non-empty string")
        if renderer["apiVersion"] != SUPPORTED_RENDERER_API_VERSION:
            errors.append(
                f"[{renderer_label}] unsupported apiVersion {renderer['apiVersion']} "
                f"(expected {SUPPORTED_RENDERER_API_VERSION})"
            )
        platforms = renderer["platforms"]
        if not platforms:
            errors.append(f"[{renderer_label}] 'platforms' must not be empty")
        for platform in sorted(set(platforms) - SUPPORTED_RENDERER_PLATFORMS):
            errors.append(f"[{renderer_label}] unsupported platform '{platform}'")
        renderer_requires = renderer["requires"]
        if renderer_requires is not None:
            if len(renderer_requires) != len(set(renderer_requires)):
                errors.append(f"[{renderer_label}] 'requires' contains duplicate ids")
            for external_id in renderer_requires:
                if external_id not in external_ids:
                    errors.append(
                        f"[{renderer_label}] unknown manifest dependency '{external_id}'"
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


def run_validate(changed_files=None, scan_mode=False):
    """Validate manifests for changed plugins.  Returns True if all pass."""
    if "--validate" in (changed_files or []):
        changed_files = [f for f in changed_files if f != "--validate"]

    if scan_mode:
        dirs = sorted(
            d for d in os.listdir(PLUGINS_DIR)
            if os.path.isdir(os.path.join(PLUGINS_DIR, d))
        ) if os.path.isdir(PLUGINS_DIR) else []
    elif not changed_files:
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
        manifest = parse_manifest(os.path.join(dp, js))
        if manifest:
            plugin_id = manifest.get("id", "")
            if isinstance(plugin_id, str) and plugin_id:
                existing_ids.setdefault(plugin_id, d)
        if errs:
            all_errors.extend(errs)
        else:
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
        scan_mode = "--scan" in args
        changed_files = [f for f in args if f not in ("--validate", "--scan")]
        ok = run_validate(changed_files, scan_mode=scan_mode)
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
