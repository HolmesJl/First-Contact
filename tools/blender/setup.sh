#!/usr/bin/env bash
# One-time setup for the MPFB character spike (tools/build-mpfb-characters.mjs).
# Downloads Blender 4.2 LTS (portable), installs the MPFB extension, the CC0 MakeHuman asset packs and the
# ACCAD mocap BVH files into tools/.cache. Needs curl, unzip, tar and about 2.5 GB of disk.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$HERE/../.cache"
mkdir -p "$CACHE"
cd "$CACHE"

BLENDER_VERSION=4.2.23
if [ ! -x blender/blender ]; then
  curl -fL -o blender.tar.xz "https://download.blender.org/release/Blender4.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz"
  mkdir -p blender
  tar xf blender.tar.xz -C blender --strip-components=1
  rm blender.tar.xz
fi

# MPFB 2.0.17 from the Blender extensions platform (GPL-3.0 add-on; only its exported meshes are used).
MPFB_URL="https://extensions.blender.org/download/sha256:4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87/add-on-mpfb-v2.0.17.zip"
curl -fL -o mpfb.zip "$MPFB_URL"
./blender/blender --background --command extension install-file -r user_default --enable mpfb.zip
rm mpfb.zip

# MakeHuman asset packs (CC0): system assets (skins, eyes, brows, lashes, hair) + ARKit face units.
DATA="$HOME/.config/blender/4.2/extensions/.user/user_default/mpfb/data"
mkdir -p "$DATA"
curl -fL -o assets.zip https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
unzip -q -o assets.zip -d "$DATA"
curl -fL -o faceunits01.zip https://files.makehumancommunity.org/functional/faceunits01.zip
unzip -q -o faceunits01.zip -d "$DATA"
rm assets.zip faceunits01.zip

# ACCAD Open Motion Project (CC BY 3.0): Female 1, Male 1 (and Male 2, unused so far) as BVH.
mkdir -p accad
for f in Female1_bvh Male1_bvh Male2_bvh; do
  curl -fL -o "$f.zip" "https://accad.osu.edu/sites/accad.osu.edu/files/$f.zip"
  unzip -q -o "$f.zip" -d "accad/$f"
  rm "$f.zip"
done

echo "Done. Run: cd tools && npm install && npm run build:mpfb"
