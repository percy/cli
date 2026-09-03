#!/bin/bash
# Smoke-test a packaged percy executable.
#
# Why this isn't just `./percy --version`: the executables are built on Node 14,
# where an unhandled promise rejection is reported as a *warning* and the process
# still exits 0. So a binary that throws on startup (e.g. a bad require produced
# by the CJS transpile) prints a stack trace yet a bare `--version` exit-code
# check passes — and the release pipeline happily uploads a broken binary.
#
# This script treats the binary as broken if `--version` either exits non-zero,
# fails to print a real version, or emits any runtime-error marker on stdout/stderr.
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

# Node 14 turns startup crashes into non-fatal warnings, so scan the output for
# the error signatures a broken binary leaves behind.
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
