#!/usr/bin/env bash
# Проверка окружения: node, playwright, chromium, ffmpeg.
set -u
ok=1
for c in node ffmpeg curl; do
  command -v "$c" >/dev/null && echo "OK  $c" || { echo "НЕТ $c"; ok=0; }
done
if node -e "require('playwright')" 2>/dev/null || node -e "import('playwright')" 2>/dev/null; then
  echo "OK  playwright"
else
  echo "НЕТ playwright (npm i -g playwright или npm i playwright в папке навыка)"; ok=0
fi
if python3 -c "import numpy" 2>/dev/null; then echo "OK  numpy (звук)"; else echo "--  numpy нет: ролики соберутся без звука (pip install numpy)"; fi
if [ -f "$(dirname "$0")/../vendor/node_modules/three/build/three.module.js" ]; then echo "OK  three (3D)"; else echo "--  three не установлен: поставится сам при первом 3D-рендере (node scripts/setup-3d.mjs)"; fi
exit $((1-ok))
