#!/bin/sh
# Downloads the pinned Foundry release (forge, anvil) into tools/foundry (gitignored) and checks its SHA-256
# against the digests GitHub records for the release assets (foundry-rs/foundry v1.8.5, 2026-10-05).
set -eu
VERSION=v1.8.5
case "$(uname -s)_$(uname -m)" in
  Darwin_arm64) TARGET=darwin_arm64; SUM=56049728e25e44a61c7f2e49438023b0890cb45850ffcb7c882f90cd998baf83 ;;
  Darwin_x86_64) TARGET=darwin_amd64; SUM=b919f69bb4231ad68beaaba9dc8f7d36d9d552cef1a76a8bf69c2bdfd974339a ;;
  Linux_x86_64) TARGET=linux_amd64; SUM=6c66ffcc55fa4249197721baa3098bc208014ea1d8aa04b2ed50ac6bccffb226 ;;
  Linux_aarch64) TARGET=linux_arm64; SUM=5bdce3dade8b6f0a65d4fccf6908426aee4905a988b08dce79d0a72fe7498310 ;;
  *) echo "No pinned Foundry build for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
DIR="$(cd "$(dirname "$0")/.." && pwd)/tools/foundry"
if [ -x "$DIR/forge" ] && [ "$(cat "$DIR/VERSION" 2>/dev/null)" = "$VERSION" ]; then
  echo "Foundry $VERSION already in $DIR"
  exit 0
fi
mkdir -p "$DIR"
TAR="$DIR/foundry.tar.gz"
curl -fsSL -o "$TAR" "https://github.com/foundry-rs/foundry/releases/download/$VERSION/foundry_${VERSION}_${TARGET}.tar.gz"
echo "$SUM  $TAR" | shasum -a 256 -c -
tar -xzf "$TAR" -C "$DIR"
rm "$TAR"
echo "$VERSION" > "$DIR/VERSION"
"$DIR/forge" --version
