#!/usr/bin/env bash
# Create a folder for a new oral history inside the vault, with a summary sheet.
# Usage: scripts/new_interview.sh /path/to/mounted/vault OH003
set -euo pipefail

VAULT="${1:?Usage: $0 /path/to/mounted/vault OH###}"
ID="${2:?Give an interview ID such as OH003}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$VAULT/FeelingTheMachine/02_oral_history/$ID"

[[ "$ID" =~ ^OH[0-9]{3}$ ]] || { echo "ID must look like OH003" >&2; exit 1; }
[ -d "$VAULT/FeelingTheMachine" ] || { echo "Run scripts/make_vault.sh first." >&2; exit 1; }
[ -e "$DIR" ] && { echo "$DIR already exists." >&2; exit 1; }

mkdir -p "$DIR"/{audio,transcript,forms}
sed "s/OH___/$ID/" "$REPO/templates/interview-summary-sheet.md" > "$DIR/${ID}_summary.md"
echo "Created $DIR"
echo "Next: Form 2 sent? Recorder tested? Confidentiality reminder ready?"
