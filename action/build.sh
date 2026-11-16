#!/usr/bin/env bash
# Builds crankpath from the checkout this Action lives in (BR10.6): the repository root is the
# parent of action/. The locked dependencies are installed with `npm ci --ignore-scripts` (no
# install script runs) and the CLI is compiled with `npm run build`. Nothing is installed from a
# registry under the name crankpath, and nothing is written into the workspace being checked.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here/.."
npm ci --ignore-scripts
npm run build
