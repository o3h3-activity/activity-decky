#!/bin/sh
set -e

cd /backend

make GAME_ANATOMY_DIR=/plugin/game-anatomy CARGO_TARGET_DIR=/tmp/game-anatomy-target
cp /plugin/game-anatomy/LICENSE /backend/out/game-anatomy.LICENSE