#!/usr/bin/env bash
#
# Lint one file, right after Claude edits it.
#
# Every architectural rule in this repository is an ESLint rule with an
# explanatory message — which layer may import what, `as`, `process.env`, raw
# colours, `enum`. Those messages are only useful if someone reads them, and
# `pnpm lint` at the end of a long editing session reports them far from the
# edit that caused them. This runs the same rules on the one file that changed.
#
# Exit 2 hands stderr back to Claude in the same turn. Any other failure exits 0:
# a hook that blocks editing because jq is missing would be worse than no hook.
#
# NOT a merge gate. It constrains this agent, not a human with a terminal, and
# nothing here stops a violation reaching origin/main. See CLAUDE.md section 11.
set -uo pipefail

payload=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')

[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

# Emitted code and build output are not authored here.
case "$file" in
  */node_modules/* | */src/generated/* | */.next/* | */dist/*) exit 0 ;;
esac

# The nearest ancestor holding an eslint.config.js owns the rules for this file:
# @leoni/core is linted as the pure domain layer, @leoni/api as the application
# layer, apps/web as the Next app. Linting from the repository root would apply
# the wrong config, or none.
dir=$(cd "$(dirname "$file")" && pwd)
while [ "$dir" != "/" ] && [ ! -f "$dir/eslint.config.js" ]; do
  dir=$(dirname "$dir")
done
[ -f "$dir/eslint.config.js" ] || exit 0

# The repo requires Node >= 24 (Prisma 7, ESLint 10, pnpm 11). The hook inherits
# whatever shell Claude Code was started from, which may default to an older one.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  nvm use 24 >/dev/null 2>&1 || true
fi

cd "$dir" || exit 0

if ! output=$(pnpm exec eslint --no-warn-ignored "$file" 2>&1); then
  {
    echo "ESLint rejected $file — the rule messages explain why:"
    echo
    printf '%s\n' "$output"
  } >&2
  exit 2
fi
