"""Entry point for the Dino Run asset build. Run through art/build.ps1 or art/build.sh:

    blender -b --factory-startup -P art/blender/build.py -- [--only trex,egg] [--preview] [--size 1]

Writes GLB files and WebP textures to public/assets/ and updates
public/assets/manifest.json, which the game reads at start-up.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib import common as C  # noqa: E402

import costumes  # noqa: E402
import props  # noqa: E402
import scenery  # noqa: E402

GROUPS = {
    'costumes': (lambda: list(costumes.SPECIES), costumes.build),
    'props': (lambda: list(props.ASSETS), props.build),
    'scenery': (lambda: list(scenery.ASSETS), scenery.build),
}


def main(opts):
    from lib import bake as B
    B.DEBUG_PNG = opts['preview']
    path = os.path.join(C.OUT, 'manifest.json')
    only = set(opts['only'])
    for group, (names, build) in GROUPS.items():
        for name in names():
            if only and name not in only and group not in only:
                continue
            entry = build(name, opts)
            # re-read before writing so separate builds don't drop each other's entries
            man = {'version': 1}
            if os.path.exists(path):
                with open(path, encoding='utf-8') as f:
                    man = json.load(f)
            man.setdefault(group, {})[name] = entry
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(man, f, indent=2, sort_keys=True)
                f.write('\n')


C.run(main)
