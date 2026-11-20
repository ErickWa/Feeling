#!/usr/bin/env bash
# Create the project folder structure inside a MOUNTED encrypted vault.
# Usage: scripts/make_vault.sh /path/to/mounted/vault
set -euo pipefail

VAULT="${1:?Usage: $0 /path/to/mounted/vault}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$VAULT/FeelingTheMachine"

case "$ROOT" in
  "$REPO"*) echo "Refusing: the vault must not be inside the git repo." >&2; exit 1 ;;
esac

mkdir -p "$ROOT"/{01_panel,02_oral_history,04_wave0,05_journal,06_corpus,07_admin}

copy_if_missing() { [ -e "$2" ] || cp "$1" "$2"; }
copy_if_missing "$REPO/templates/contact-log.csv"     "$ROOT/01_panel/contact-log.csv"
copy_if_missing "$REPO/templates/consent-register.csv" "$ROOT/07_admin/consent-register.csv"
copy_if_missing "$REPO/templates/withdrawal-log.csv"  "$ROOT/07_admin/withdrawal-log.csv"
copy_if_missing "$REPO/templates/decision-log.md"     "$ROOT/07_admin/decision-log.md"

echo "Vault structure ready at $ROOT"
echo "Reminder: create the ID-to-name key (03_key/key.csv) in a SEPARATE vault with a different password."
