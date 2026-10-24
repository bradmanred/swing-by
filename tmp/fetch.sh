#!/bin/bash
# One-off fetches for the Kent import. Saves each URL into tmp/out with pdftotext for PDFs.
mkdir -p tmp/out
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
i=0
while read -r url; do
  [ -z "$url" ] && continue
  i=$((i+1)); f="tmp/out/$i"
  code=$(curl -sSL -A "$UA" --max-time 60 -o "$f.bin" -w '%{http_code} %{content_type}' "$url" || echo ERR)
  echo "$i $code $url" >> tmp/out/index.txt
  if file "$f.bin" | grep -q PDF; then pdftotext -layout "$f.bin" "$f.txt"; rm "$f.bin"; else mv "$f.bin" "$f.html"; fi
done < tmp/urls.txt
