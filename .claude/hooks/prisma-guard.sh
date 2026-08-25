#!/usr/bin/env bash
#
# Runs after Claude edits a Prisma schema file.
#
# Two things go wrong with a schema change and neither has a local symptom:
# the schema stops parsing (caught by the next `prisma generate`, possibly on
# someone else's machine), or the schema changes with no migration to carry it
# (caught by the next person's `pnpm db:migrate`, as a conflict they did not
# cause).
#
# `prisma validate` needs no database. The drift check does, so it degrades to a
# reminder when Postgres is unreachable rather than blocking the edit.
set -uo pipefail

payload=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')

[ -n "$file" ] || exit 0
case "$file" in
  *.prisma) ;;
  *) exit 0 ;;
esac

repo_root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$file")/../../../.." && pwd)}"
db_package="$repo_root/packages/db"
[ -d "$db_package" ] || exit 0

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  nvm use 24 >/dev/null 2>&1 || true
fi

cd "$db_package" || exit 0

# 1. Does it still parse?
if ! validation=$(pnpm exec prisma validate 2>&1); then
  {
    echo "The Prisma schema no longer validates:"
    echo
    printf '%s\n' "$validation"
  } >&2
  exit 2
fi

# 2. Is there a migration for it?
#
# `--exit-code` returns 2 when the live database and the schema differ. That is
# the signal we want: the schema has been changed and no migration carries the
# change. Exit 1 means the database was unreachable, which is not the agent's
# mistake and must not block the edit.
diff_output=$(pnpm exec prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema --script --exit-code 2>&1)
status=$?

if [ "$status" -eq 2 ]; then
  {
    echo "The schema now differs from the database — this change has no migration."
    echo
    echo "The SQL a migration would have to contain:"
    echo
    printf '%s\n' "$diff_output" | sed 's/^/    /'
    echo
    echo "Create one before saying the change is done. \`prisma migrate dev\` needs a TTY,"
    echo "so in a non-interactive shell write the file yourself (see CLAUDE.md section 9):"
    echo
    echo "    mkdir -p prisma/migrations/\$(date +%Y%m%d%H%M%S)_<snake_case_name>"
    echo "    pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema \\"
    echo "      --script > prisma/migrations/<that_dir>/migration.sql"
    echo "    pnpm exec prisma migrate deploy"
    echo
    echo "Then \`pnpm db:check\` must exit 0 and \`pnpm test\` must pass —"
    echo "schema-conventions.test.ts checks the mapping, indexing and onDelete rules."
  } >&2
  exit 2
fi

exit 0
