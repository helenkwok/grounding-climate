#!/bin/sh
# forge test, then the anvil integration (packages/core/test/evm-anvil.test.ts), which must not skip here.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORGE="$ROOT/tools/foundry/forge"
[ -x "$FORGE" ] || FORGE=forge
"$FORGE" test --root "$ROOT/contracts"
npm run build --workspace @grounding-climate/core
REQUIRE_ANVIL=1 node --test "$ROOT/packages/core/dist/test/evm-anvil.test.js"
