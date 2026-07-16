#!/usr/bin/env bash
# Compiles the Go diff engine to WebAssembly and stages it under public/ so
# Vite picks it up as a static asset. Run via `npm run build:wasm`.
set -euo pipefail

cd "$(dirname "$0")/.."

GOROOT="$(go env GOROOT)"
WASM_EXEC="$GOROOT/lib/wasm/wasm_exec.js"
if [ ! -f "$WASM_EXEC" ]; then
  # Older Go toolchains ship wasm_exec.js under misc/wasm instead.
  WASM_EXEC="$GOROOT/misc/wasm/wasm_exec.js"
fi

mkdir -p public
cp "$WASM_EXEC" public/wasm_exec.js
GOOS=js GOARCH=wasm go build -o public/main.wasm ./cmd/wasm

echo "wasm build complete: public/main.wasm"
