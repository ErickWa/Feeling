#!/usr/bin/env bash
# Rebuild site/fonts/noto-serif-sc-{600,900}.woff2 from the full Noto Serif SC,
# keeping only the Chinese characters the pages use. Run it whenever Chinese
# text changes; `npm run check` fails until you do (tests/fonts.test.mjs).
#
# Needs fonttools with brotli (`pip install fonttools brotli`, in a venv) and the
# variable font from https://github.com/google/fonts/tree/main/ofl/notoserifsc
# (NotoSerifSC[wght].ttf, about 25 MB; not kept in the repo).
#
# Usage: scripts/subset_han.sh /path/to/NotoSerifSC[wght].ttf
#
# The whole font is ~25 MB; the pages use a few hundred characters, so the two
# cut-down weights come to a few hundred KB. A character missing from the cut
# is not broken, only plainer: the CSS falls back to the system's Songti/SimSun.
set -euo pipefail

SRC="${1:?Usage: $0 /path/to/NotoSerifSC[wght].ttf}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/site/fonts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Every CJK ideograph and CJK/full-width punctuation mark in any page, sorted.
python3 -I - "$REPO/site" > "$OUT/han-chars.txt" <<'EOF'
import pathlib, re, sys
text = "".join(p.read_text("utf8") for p in sorted(pathlib.Path(sys.argv[1]).glob("*.html")))
chars = set(re.findall(r"[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef\u201c\u201d\u2018\u2019\u00b7\u2026\u2014]", text))
print("".join(sorted(chars)))
EOF

for w in 600 900; do
  fonttools varLib.instancer -q "$SRC" "wght=$w" -o "$TMP/$w.ttf"
  pyftsubset "$TMP/$w.ttf" --text-file="$OUT/han-chars.txt" --flavor=woff2 \
    --layout-features='*' --output-file="$OUT/noto-serif-sc-$w.woff2"
done

ls -l "$OUT"/noto-serif-sc-*.woff2
echo "$(wc -m < "$OUT/han-chars.txt" | tr -d ' ') characters. Commit han-chars.txt with the fonts."
