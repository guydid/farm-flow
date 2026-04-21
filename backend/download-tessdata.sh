#!/bin/bash
# Download Tesseract language data files for OCR
# Run this once on the server: bash download-tessdata.sh

set -e
TESSDATA_DIR="$(dirname "$0")/tessdata"
mkdir -p "$TESSDATA_DIR"
cd "$TESSDATA_DIR"

echo "Downloading eng.traineddata..."
if [ ! -f eng.traineddata ]; then
  # Try projectnaptha CDN (gzipped) first
  if curl -fL --connect-timeout 30 -o eng.traineddata.gz \
    "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz" 2>/dev/null; then
    gunzip -f eng.traineddata.gz
    echo "  eng.traineddata downloaded from CDN ($(du -sh eng.traineddata | cut -f1))"
  else
    # Fallback: GitHub tessdata repo (not gzipped, ~12MB)
    curl -fL --connect-timeout 30 -o eng.traineddata \
      "https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata"
    echo "  eng.traineddata downloaded from GitHub ($(du -sh eng.traineddata | cut -f1))"
  fi
else
  echo "  eng.traineddata already exists, skipping."
fi

echo "Downloading heb.traineddata..."
if [ ! -f heb.traineddata ]; then
  if curl -fL --connect-timeout 30 -o heb.traineddata.gz \
    "https://tessdata.projectnaptha.com/4.0.0/heb.traineddata.gz" 2>/dev/null; then
    gunzip -f heb.traineddata.gz
    echo "  heb.traineddata downloaded from CDN ($(du -sh heb.traineddata | cut -f1))"
  else
    curl -fL --connect-timeout 30 -o heb.traineddata \
      "https://github.com/tesseract-ocr/tessdata/raw/main/heb.traineddata"
    echo "  heb.traineddata downloaded from GitHub ($(du -sh heb.traineddata | cut -f1))"
  fi
else
  echo "  heb.traineddata already exists, skipping."
fi

echo ""
echo "Done! Files in $TESSDATA_DIR:"
ls -lh "$TESSDATA_DIR"/*.traineddata
