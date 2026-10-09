#!/usr/bin/env bash
# One-time setup for the character pipeline (tools/build-characters.mjs, tools/blender/*.py).
# Downloads portable Blender 4.2 LTS and the ACCAD motion capture BVH files into tools/.cache.
# Needs curl, unzip, tar and about 1 GB of disk.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$HERE/../.cache"
mkdir -p "$CACHE"
cd "$CACHE"

BLENDER_VERSION=4.2.23
if [ ! -x blender/blender ]; then
  FILE="blender-${BLENDER_VERSION}-linux-x64.tar.xz"
  # download.blender.org rejects some cloud networks (HTTP 403); fall back to a public mirror.
  curl -fL -o blender.tar.xz "https://download.blender.org/release/Blender4.2/$FILE" \
    || curl -fL -o blender.tar.xz "https://ftp.nluug.nl/pub/graphics/blender/release/Blender4.2/$FILE"
  mkdir -p blender
  tar xf blender.tar.xz -C blender --strip-components=1
  rm blender.tar.xz
fi

# ACCAD Open Motion Project (CC BY 3.0): Female 1 and Male 1 as BVH.
mkdir -p accad
for f in Female1_bvh Male1_bvh; do
  [ -d "accad/$f" ] && continue
  curl -fL -o "$f.zip" "https://accad.osu.edu/sites/accad.osu.edu/files/$f.zip"
  unzip -q -o "$f.zip" -d "accad/$f"
  rm "$f.zip"
done

echo "Done. Run: cd tools && npm install && npm run build:characters"
