#!/usr/bin/env bash
# Runs a real `next build` in this sandbox.
#
# next/font/google fetches from Google at build time, which this container
# cannot reach, so Oswald and Karla are stubbed for the duration and put back
# afterwards — including on failure, which is what the trap is for. The stub
# only ever touches the two font objects; everything else about the build is
# the real thing.
#
# NEVER COMMIT app/layout.tsx WHILE THIS IS RUNNING.
set -uo pipefail
cd "$(dirname "$0")/.."

REAL=$(mktemp)
cp app/layout.tsx "$REAL"
restore() { cp "$REAL" app/layout.tsx; rm -f "$REAL"; }
trap restore EXIT INT TERM

python3 - <<'PY'
p = 'app/layout.tsx'
s = open(p).read()
s = s.replace("import { Oswald, Karla } from 'next/font/google'\n", "")
s = s.replace("""const display = Oswald({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-display',
})

const body = Karla({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-body',
})""", """const display = { variable: '--font-display' }
const body = { variable: '--font-body' }""")
open(p, 'w').write(s)
PY

npx next build
STATUS=$?

echo
echo "BUILD EXIT: $STATUS"
exit $STATUS
