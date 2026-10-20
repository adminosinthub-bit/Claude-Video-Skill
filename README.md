# Claude-Video-Skill

Навык (skill) для Claude: **делает видео через HTML**. Claude лучше всего работает с дизайном в HTML,
поэтому навык:

1. создаёт несколько разных вариантов ролика в HTML/CSS;
2. рендерит каждый в видео (покадровый захват в Chromium + ffmpeg);
3. сам смотрит на кадры и оценивает варианты по рубрике;
4. выбирает лучший и собирает финал, перенося удачные решения из остальных вариантов;
5. проверяет финал и при необходимости итерирует.

## Структура
- `SKILL.md` — инструкция для Claude (процесс и правила)
- `scripts/render.mjs` — HTML → MP4: параллельный детерминированный рендер, пресеты, `--max` (60 fps + motion blur), автозвук из сцен, фрагменты
- `scripts/sfx.py` — синтез звуков и лоу-фай музыки по таймлайну сцен (numpy)
- `scripts/frame.mjs` — быстрый просмотр отдельных кадров
- `scripts/contact-sheet.sh` — контактный лист кадров для анализа (авто-раскладка для вертикальных видео)
- `scripts/logos.mjs` — автопоиск логотипов брендов (simple-icons → сайт → Wikimedia → favicon) и подстановка в HTML; `scripts/logos.selftest.mjs` — самотест
- `scripts/check-env.sh` — проверка node / playwright / ffmpeg / curl
- `references/engine.js` — движок сцен (субтитры с подсветкой, прогресс, переходы, easing)
- `assets/logos/_custom/` — ваш бренд-кит (приоритет над автопоиском)
- `references/parts.js` — логотипы `P.logo`/`P.logoTile`, маскоты (бот, сова), иконки, огонёк серии, телефон, касание пальцем, конфетти, окно macOS, пузыри чата
- `references/` — контракт анимации, рубрика оценки, дизайн-заметки, шаблоны HTML
- `examples/` — готовые ролики: реклама Claude (16:9), реклама ChatGPT (9:16, 25 с), реклама Duolingo (9:16, 40 с, 60 fps) и реклама самого Claude (9:16, 39 с, 60 fps); у вертикальных — три варианта и финал

## Установка
Скопируйте репозиторий в `~/.claude/skills/html-video-variants/` (или `.claude/skills/` проекта).
Нужны `node`, `playwright` (с Chromium) и `ffmpeg`.

## Пример
```bash
node scripts/render.mjs examples/chatgpt-ad/final.html --out demo.mp4 --preset vertical --duration 25.4
bash scripts/contact-sheet.sh demo.mp4 demo-sheet.png 12
```
Если Chromium лежит не в стандартном месте, задайте `PW_CHROMIUM_PATH`.
