#!/usr/bin/env python3
"""
Checks the merged manifest of built APKs (used by .github/workflows/saloona.yml).

For each APK it fails when
  - a <uses-permission> is not on the allow-list below, or
  - any component other than MainActivity is exported.
Usage: ci-manifest-check.py <aapt2> <apk> [<apk> ...]
"""
import re
import subprocess
import sys

ALLOWED_PERMISSIONS = {
    "android.permission.USE_BIOMETRIC",
    "android.permission.USE_FINGERPRINT",  # androidx.biometric, needed on Android 8-9
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.RECEIVE_BOOT_COMPLETED",
}
# androidx.core declares <package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION (signature level).
ALLOWED_SUFFIXES = (".DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",)
COMPONENTS = {"activity", "activity-alias", "service", "receiver", "provider"}
ALLOWED_EXPORTED = {"dk.saloona.app.MainActivity"}


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def check(aapt2: str, apk: str) -> list[str]:
    errors: list[str] = []
    perms = run(aapt2, "dump", "permissions", apk)
    used = re.findall(r"uses-permission(?:-sdk-23)?: name='([^']+)'", perms)
    print(f"{apk}: uses-permission = {sorted(set(used))}")
    for p in used:
        if p not in ALLOWED_PERMISSIONS and not p.endswith(ALLOWED_SUFFIXES):
            errors.append(f"uønsket permission: {p}")

    tree = run(aapt2, "dump", "xmltree", "--file", "AndroidManifest.xml", apk)
    current = None  # (kind, depth, name, exported)
    found: list[tuple[str, str, bool]] = []

    def flush() -> None:
        if current is not None:
            found.append((current[0], current[2] or "?", current[3]))

    for line in tree.splitlines():
        m = re.match(r"^(\s*)E: ([\w-]+)", line)
        if m:
            depth = len(m.group(1))
            if current is not None and depth <= current[1]:
                flush()
                current = None
            if m.group(2) in COMPONENTS:
                current = [m.group(2), depth, None, False]
            continue
        if current is None:
            continue
        a = re.match(r'^\s*A: http://schemas.android.com/apk/res/android:(name|exported)\([^)]*\)=(?:"([^"]*)"|(\S+))', line)
        # Only the component's own attributes (one level deeper), not those of
        # nested elements such as <action android:name=...> in an intent-filter.
        if a and len(line) - len(line.lstrip()) == current[1] + 2:
            value = a.group(2) if a.group(2) is not None else a.group(3)
            if a.group(1) == "name":
                current[2] = value
            elif a.group(1) == "exported":
                current[3] = value in ("true", "0xffffffff", "-1")
    flush()

    for kind, name, exported in found:
        print(f"  {kind:15} exported={str(exported):5} {name}")
        if exported and name not in ALLOWED_EXPORTED:
            errors.append(f"eksporteret komponent: {kind} {name}")
    if not any(n in ALLOWED_EXPORTED for _, n, _ in found):
        errors.append("MainActivity blev ikke fundet i manifestet")
    return errors


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    aapt2, apks = sys.argv[1], sys.argv[2:]
    failed = False
    for apk in apks:
        for e in check(aapt2, apk):
            print(f"::error::{apk}: {e}")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
