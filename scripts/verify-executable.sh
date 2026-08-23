#!/bin/bash
# Smoke-test a packaged percy executable.
#
# Treats the binary as broken if `--version` exits non-zero, prints no version,
# or emits a runtime-error marker — a bare exit-code check misses startup crashes.
#
# Usage: scripts/verify-executable.sh [path-to-binary]   (default: ./percy)
set -u -o pipefail

BIN="${1:-./percy}"
echo "Verifying: $BIN --version"

# Capture stdout+stderr together; keep the exit code without tripping set -e.
output="$("$BIN" --version 2>&1)"
status=$?

echo "----- output -----"
echo "$output"
echo "------------------"

if [ "$status" -ne 0 ]; then
  echo "::error::'$BIN --version' exited with status $status"
  exit 1
fi

# Scan for the signatures a binary that crashed on startup leaves behind.
if echo "$output" | grep -qiE 'UnhandledPromiseRejection|is not a function|TypeError|ReferenceError|SyntaxError|Cannot find module|Error:'; then
  echo "::error::'$BIN --version' emitted a runtime error (binary is broken)"
  exit 1
fi

# A healthy binary prints its semver. If it crashed before printing one, fail.
if ! echo "$output" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'; then
  echo "::error::'$BIN --version' did not print a valid version string"
  exit 1
fi

echo "OK: $BIN is healthy"

# pkg's default targets follow the host arch, so assert explicitly.
arch_info="$(file "$BIN")"
if ! echo "$arch_info" | grep -qE 'x86[-_]64'; then
  echo "::error::'$BIN' is not an x86-64 binary: $arch_info"
  exit 1
fi
echo "OK: $BIN is x86-64"
