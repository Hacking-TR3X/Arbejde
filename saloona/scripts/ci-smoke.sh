#!/usr/bin/env bash
# Smoke test for Saloona APKs on a running emulator (used by .github/workflows/saloona.yml).
#
# Usage: scripts/ci-smoke.sh <out-dir> <apk>:<package>:<label> [<apk>:<package>:<label> ...]
#
# For each APK: install, launch MainActivity, wait, then check that
#   - the app process is still alive and did not log a FATAL EXCEPTION,
#   - logcat has no Content Security Policy refusals ("Refused to ...").
#     Only the debug build logs WebView console messages (Capacitor logging is
#     off in release), so for release this check is blind and the other two carry it,
#   - the UI (uiautomator dump) contains the text $SMOKE_EXPECT_TEXT (default "Saloona")
#     and not the "WebView skal opdateres" dialog.
# Writes saloona-smoke-<label>.png, the UI dump and logcat (full + filtered) to <out-dir>.
# The emulator holds no real data, so these files contain no personal data.
# Runs every APK even if an earlier one fails; exits 1 if any failed.

set -uo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <out-dir> <apk>:<package>:<label> [...]" >&2
  exit 2
fi

OUT="$1"
shift
mkdir -p "$OUT"

EXPECT="${SMOKE_EXPECT_TEXT:-Saloona}"
ACTIVITY="dk.saloona.app.MainActivity"
WAIT_SECONDS="${SMOKE_WAIT_SECONDS:-20}"

if command -v adb >/dev/null 2>&1; then
  ADB="adb"
else
  ADB="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/platform-tools/adb"
fi

"$ADB" wait-for-device
for _ in $(seq 1 90); do
  if [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    break
  fi
  sleep 2
done

overall=0

smoke_one() {
  local apk="$1" pkg="$2" label="$3"
  local ui="$OUT/saloona-ui-$label.xml"
  local log_full="$OUT/logcat-$label-full.txt"
  local log_filtered="$OUT/logcat-$label.txt"
  local shot="$OUT/saloona-smoke-$label.png"
  local failed=0

  echo "::group::Smoke test $label ($pkg)"

  if [ ! -f "$apk" ]; then
    echo "::error::$label: APK findes ikke: $apk"
    echo "::endgroup::"
    return 1
  fi

  "$ADB" uninstall "$pkg" >/dev/null 2>&1 || true
  if ! "$ADB" install -r "$apk"; then
    echo "::error::$label: installation fejlede"
    echo "::endgroup::"
    return 1
  fi

  "$ADB" logcat -c || true
  "$ADB" shell am start -W -n "$pkg/$ACTIVITY"
  sleep "$WAIT_SECONDS"

  # The WebView's accessibility tree is built lazily after uiautomator connects,
  # so the first dump can be empty. Retry a few times.
  local found=0
  for _ in 1 2 3 4 5 6; do
    rm -f "$ui"
    "$ADB" shell uiautomator dump /sdcard/saloona-ui.xml >/dev/null 2>&1 || true
    "$ADB" pull /sdcard/saloona-ui.xml "$ui" >/dev/null 2>&1 || true
    if [ -f "$ui" ] && grep -q -E "(text|content-desc)=\"[^\"]*${EXPECT}" "$ui"; then
      found=1
      break
    fi
    sleep 5
  done

  "$ADB" exec-out screencap -p > "$shot" || echo "::warning::$label: screencap fejlede"
  "$ADB" logcat -d > "$log_full" 2>/dev/null || true
  grep -E "Refused to|Content Security Policy|FATAL EXCEPTION|AndroidRuntime|chromium" "$log_full" > "$log_filtered" || true

  if [ "$found" -ne 1 ]; then
    echo "::error::$label: teksten \"$EXPECT\" blev ikke fundet i UI-dumpet"
    failed=1
  fi
  if [ -f "$ui" ] && grep -q "WebView skal opdateres" "$ui"; then
    echo "::error::$label: appen viser advarslen om en for gammel WebView"
    failed=1
  fi
  # No `grep -q` at the end of a pipe: with pipefail an early exit could turn a
  # match into a SIGPIPE failure and hide the crash.
  if grep -A3 "FATAL EXCEPTION" "$log_full" | grep "Process: $pkg," >/dev/null; then
    echo "::error::$label: appen crashede (FATAL EXCEPTION, se $log_filtered)"
    failed=1
  fi
  if ! "$ADB" shell pidof "$pkg" >/dev/null 2>&1; then
    echo "::error::$label: appens proces kører ikke efter start"
    failed=1
  fi
  if grep -q -E "Refused to|Content Security Policy" "$log_full"; then
    echo "::error::$label: CSP-afvisninger i logcat:"
    grep -E "Refused to|Content Security Policy" "$log_full" | head -20
    failed=1
  fi

  if [ "$failed" -eq 0 ]; then
    echo "$label: OK"
  fi
  echo "::endgroup::"
  return "$failed"
}

for target in "$@"; do
  IFS=':' read -r apk pkg label <<< "$target"
  if [ -z "${apk:-}" ] || [ -z "${pkg:-}" ] || [ -z "${label:-}" ]; then
    echo "::error::Ugyldigt mål: $target (forventet <apk>:<package>:<label>)"
    overall=1
    continue
  fi
  if ! smoke_one "$apk" "$pkg" "$label"; then
    overall=1
  fi
done

exit "$overall"
