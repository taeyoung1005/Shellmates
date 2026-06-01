#!/usr/bin/env bash
# Open the isolated Shellmates channel session from a coding session.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
SHELLMATES_DIR="${SHELLMATES_DIR:-$HOME/shellmates}"
WINDOW_TITLE="Shellmates"
LAUNCH="claude --dangerously-load-development-channels server:shellmates-channel"

if [ ! -f "$SHELLMATES_DIR/.mcp.json" ]; then
  echo "-- Shellmates session is not configured --"
  echo "  Set it up first: cd $REPO && npm run build && npm run setup-shellmates"
  echo "  Then run again, or open manually: cd $SHELLMATES_DIR && $LAUNCH"
  echo "  Message bodies and coaching are shown only in that separate session."
  exit 0
fi

print_manual() {
  echo "-- Shellmates session --"
  echo "  Run: cd $SHELLMATES_DIR && $LAUNCH"
  echo "  Commands: /shellmates-status, /shellmates-open, /shellmates-scan, /shellmates-intro, /shellmates-reply, /shellmates-profile"
  echo "  Tool flow: shellmates_status -> shellmates_open / shellmates_scan -> shellmates_intro / shellmates_coach -> shellmates_send"
  echo "  Message bodies and coaching are shown only in that separate session."
}

open_macos_console() {
  local runcmd="cd $(printf %q "$SHELLMATES_DIR") && $LAUNCH"
  /usr/bin/osascript <<OSA 2>/dev/null
tell application "Terminal"
  set already to false
  repeat with w in windows
    try
      if (custom title of w) is "$WINDOW_TITLE" then
        set already to true
        set index of w to 1
        exit repeat
      end if
    end try
  end repeat
  activate
  if not already then
    do script "$runcmd"
    delay 0.3
    try
      set custom title of front window to "$WINDOW_TITLE"
    end try
  end if
end tell
OSA
}

if [ "${1:-}" = "--status" ] || [ "${1:-}" = "status" ]; then
  print_manual
  exit 0
fi

if [ "$(uname -s)" = "Darwin" ] && command -v /usr/bin/osascript >/dev/null 2>&1; then
  if open_macos_console; then
    echo "Opened the Shellmates channel session in a separate Terminal window (title: \"$WINDOW_TITLE\")."
    echo "New messages appear there as live <channel> notifications. Reply with /shellmates-reply or shellmates_send."
    echo "Message bodies and coaching are shown only in that separate session."
    exit 0
  fi
fi

echo "(Could not open Terminal automatically. Open it manually.)"
print_manual

