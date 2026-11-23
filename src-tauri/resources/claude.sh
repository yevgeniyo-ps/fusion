#!/bin/bash
# `claude` in a Fusion tab. Fusion puts this file first on the tab shell's PATH.
#
# `claude` alone, or with flags, runs the tab's own session. Its working directory is the
# tab folder, and each project in the tab is an --add-dir (.fusion/dirs). When the projects
# change, Fusion creates .fusion/restart and stops claude. This loop then starts claude
# again with --resume and the new dirs: the conversation stays, the access follows the tab.
#
# A subcommand (`claude mcp ...`, `claude update`) goes to the real claude as it is.
# macOS /bin/bash is 3.2: no empty-array expansion under `set -u`, no `mapfile`.
set -u
tab="$FUSION_TAB_DIR"
meta="$tab/.fusion"

# The real claude: the first one on PATH without this file's folder.
set -f
clean=""
IFS=:
for p in $PATH; do
  [ "$p" = "$meta/bin" ] || clean="${clean:+$clean:}$p"
done
unset IFS
set +f
PATH="$clean"
real=$(command -v claude) || { echo "fusion: claude is not on PATH" >&2; exit 127; }

case "${1:-}" in
  "" | -*) ;;
  *) exec "$real" "$@" ;;
esac

cd "$tab" || exit 1
sid=$(cat "$meta/session")
conf="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
echo $$ > "$meta/claude.pid"
trap 'rm -f "$meta/claude.pid"' EXIT

while :; do
  rm -f "$meta/restart"
  args=()
  while IFS= read -r d; do
    [ -n "$d" ] && args+=(--add-dir "$d")
  done < "$meta/dirs"
  # The transcript exists after the first message: resume it. Before, start the tab's id.
  if [ -n "$(find "$conf/projects" -maxdepth 2 -name "$sid.jsonl" 2>/dev/null | head -n 1)" ]; then
    args+=(--resume "$sid")
  else
    args+=(--session-id "$sid")
  fi
  # claude keeps its stderr (fd 3). The group's stderr is bash's own, so the
  # "Terminated: 15" bash prints when Fusion stops claude goes nowhere.
  { "$real" "${args[@]}" ${1+"$@"} 2>&3; } 3>&2 2>/dev/null
  rc=$?
  [ -f "$meta/restart" ] || exit "$rc"
  printf '\r\n\033[2mfusion: the projects changed. claude restarts with the new set.\033[0m\r\n'
done
