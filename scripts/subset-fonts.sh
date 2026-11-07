#!/bin/sh
# Trims Iosevka to the characters the site can realistically need. Requires
# fonttools and brotli: pip install fonttools brotli
set -e

cd "$(dirname "$0")/.."

SOURCE=node_modules/@fontsource/iosevka/files
OUT=src/styles/fonts
UNICODES="U+0020-007E,U+00A0-017F,U+0370-03FF,U+2010-2027,U+2030-205E,U+20AC,U+2122,U+2190-21FF,U+2200-22FF,U+2500-257F,U+25A0-25FF"

mkdir -p "$OUT"

for style in 400-normal 400-italic 700-normal 800-normal; do
  pyftsubset "$SOURCE/iosevka-latin-$style.woff2" \
    --unicodes="$UNICODES" \
    --layout-features='kern,mark,mkmk,ccmp,locl,calt,zero,tnum' \
    --flavor=woff2 \
    --output-file="$OUT/iosevka-$style.woff2"
done

# Preview cards are rendered at build time by resvg, which can't read woff2.
pyftsubset "$SOURCE/iosevka-latin-800-normal.woff2" \
  --unicodes="$UNICODES" \
  --layout-features='kern,mark,mkmk,ccmp,locl' \
  --flavor= \
  --output-file="$OUT/iosevka-800-normal.ttf"
