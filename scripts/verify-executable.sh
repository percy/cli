#!/bin/bash
# Smoke-test a packaged percy executable.
#
# Why this isn't just `./percy --version`: this check was written when the
# executables were built on Node 14, where an unhandled promise rejection was
# reported as a *warning* and the process still exited 0 — so a binary that threw
# on startup (e.g. a bad require produced by the CJS transpile) printed a stack
# trace yet a bare `--version` exit-code check passed, and the release pipeline
# happily uploaded a broken binary.
#
# On Node 20 that specific hole is closed twice over: unhandled rejections are
# fatal by default, and bin/run.cjs now catches startup failures and exits 1. The
# output scan below is kept as defence in depth — it still catches a binary that
# prints a stack trace and then exits 0 for some other reason. Do NOT re-justify
# it with "the executables are built on Node 14".
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

# pkg's default targets follow the host arch, so assert explicitly.
arch_info="$(file "$BIN")"
if ! echo "$arch_info" | grep -qE 'x86[-_]64|PE32\+'; then
  echo "::error::'$BIN' is not an x86-64 binary: $arch_info"
  exit 1
fi
echo "OK: $BIN is x86-64"
