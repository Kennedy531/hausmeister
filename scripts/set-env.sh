#!/usr/bin/env bash
# Saves secrets into .env.local without showing them on screen or in chat.
#
#   scripts/set-env.sh                 asks for every key that is still empty
#   scripts/set-env.sh OPENAI_API_KEY  asks for just that key (overwrites it)
#
# Press Enter on an empty line to skip a key.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] || cp .env.example .env.local

SECRETS=(NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY VAPI_API_KEY OPENAI_API_KEY
         TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER)

if [ $# -gt 0 ]; then
  names=("$@")
else
  names=()
  for n in "${SECRETS[@]}"; do
    grep -qE "^$n=.+" .env.local || names+=("$n")
  done
fi

if [ ${#names[@]} -eq 0 ]; then
  echo "Nothing to fill in: every key already has a value."
  exit 0
fi

for name in "${names[@]}"; do
  read -rsp "$name (hidden, Enter to skip): " value
  echo
  value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
  if [ -z "$value" ]; then echo "  skipped"; continue; fi
  NAME="$name" VALUE="$value" python3 - <<'PY'
import os, re
name, value = os.environ["NAME"], os.environ["VALUE"]
path = ".env.local"
text = open(path).read()
line = f"{name}={value}"
if re.search(rf"(?m)^{re.escape(name)}=", text):
    text = re.sub(rf"(?m)^{re.escape(name)}=.*$", lambda _: line, text, count=1)
else:
    text = text.rstrip("\n") + "\n" + line + "\n"
open(path, "w").write(text)
PY
  echo "  saved ($(printf %s "$value" | wc -c | tr -d ' ') characters)"
done
echo "Done. .env.local is git-ignored, so none of this gets committed."
