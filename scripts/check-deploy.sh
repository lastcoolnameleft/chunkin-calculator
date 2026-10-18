#!/usr/bin/env bash
set -euo pipefail

base="${1:-https://tracker.dfwtrebuchet.com}"
base="${base%/}"
case "$base" in
  http://*|https://*) ;;
  *) echo "Usage: $0 https://hostname" >&2; exit 1 ;;
esac
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js is required for JSON checks" >&2; exit 1; }

fetch() {
  curl --fail --silent --show-error --connect-timeout 10 --max-time 20 "$base$1"
}

fetch /healthz | node -e '
let text="";process.stdin.on("data",c=>text+=c);
process.stdin.on("end",()=>{
  const health=JSON.parse(text);
  if(health.status!=="ok")process.exit(1);
  if(process.env.EXPECTED_REVISION && health.revision!==process.env.EXPECTED_REVISION) {
    console.error("Deployment revision mismatch: "+health.revision);
    process.exit(1);
  }
});
'
fetch / | grep 'Impact Distance Tracker' >/dev/null
fetch /designs.css >/dev/null
fetch /measurements.js >/dev/null
fetch /how-it-works/ | grep 'How This Works' >/dev/null
fetch /how-it-works/triangulation-diagram.png >/dev/null
fetch /guide-assets/katex.min.css >/dev/null
fetch /api/events | node -e '
let text="";process.stdin.on("data",c=>text+=c);
process.stdin.on("end",()=>{if(!Array.isArray(JSON.parse(text)))process.exit(1)});
'
fetch /event/deployment-route-check | grep 'Impact Distance Tracker' >/dev/null
fetch /event/deployment-route-check/spectator | grep 'Impact Distance Tracker' >/dev/null
echo "Deployment checks passed: $base (no events or shots were created)"
