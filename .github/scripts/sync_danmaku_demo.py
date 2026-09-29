#!/usr/bin/env python3
"""Sync the standalone danmaku demo's embedded engine from the plugin.

Usage from the repository root:
    python .github/scripts/sync_danmaku_demo.py
    python .github/scripts/sync_danmaku_demo.py --check
"""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
plugin = root / 'plugins/better_danmaku_filter/better_danmaku_filter.js'
demo = root / 'plugins/better_danmaku_filter/better_danmaku_filter.html'
source = plugin.read_text()
core = source.split('function pluginOnInitialize()', 1)[0].rstrip() + '\n'
html = demo.read_text()
start = html.index('\n', html.index('// BEGIN PLUGIN ENGINE')) + 1
end = html.index('// END PLUGIN ENGINE', start)
if html[start:end] == core:
    print('Demo engine matches plugin.')
elif '--check' in sys.argv:
    raise SystemExit('Demo engine is outdated. Run: python .github/scripts/sync_danmaku_demo.py')
else:
    demo.write_text(html[:start] + core + html[end:])
    print('Demo engine updated from plugin.')
