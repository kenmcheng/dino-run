#!/usr/bin/env bash
# Build the game's 3D assets with Blender (headless). macOS / Linux.
#
#   ./art/build.sh                      # everything
#   ./art/build.sh --only trex,raptor   # some assets (or a group: costumes, props, scenery)
#   ./art/build.sh --only trex --preview
#
# BLENDER=/path/to/blender overrides the executable (4.2 or newer; 5.x recommended).
# Baking uses the GPU when Cycles finds one (OptiX/CUDA/HIP/Metal), else the CPU.
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
mkdir -p art/.cache
"$BLENDER" -b --factory-startup -P art/blender/build.py -- --log art/.cache/build.log "$@"
cat art/.cache/build.log
grep -q '\] exit 0$' art/.cache/build.log
