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
- `scripts/render.mjs` — HTML → MP4: параллельный детерминированный рендер, пресеты (вертикальный/горизонтальный/квадрат), фрагменты, звук
- `scripts/frame.mjs` — быстрый просмотр отдельных кадров
- `scripts/contact-sheet.sh` — контактный лист кадров для анализа (авто-раскладка для вертикальных видео)
- `scripts/check-env.sh` — проверка node / playwright / ffmpeg
- `references/engine.js` — движок сцен (субтитры с подсветкой, прогресс, переходы, easing)
- `references/parts.js` — маскот, иконки, окно macOS, пузыри чата
- `references/` — контракт анимации, рубрика оценки, дизайн-заметки, шаблоны HTML
- `examples/` — готовые ролики (реклама Claude 16:9; реклама ChatGPT 9:16: три варианта и финал)

## Установка
Скопируйте репозиторий в `~/.claude/skills/html-video-variants/` (или `.claude/skills/` проекта).
Нужны `node`, `playwright` (с Chromium) и `ffmpeg`.

## Пример
```bash
node scripts/render.mjs examples/chatgpt-ad/final.html --out demo.mp4 --preset vertical --duration 25.4
bash scripts/contact-sheet.sh demo.mp4 demo-sheet.png 12
```
Если Chromium лежит не в стандартном месте, задайте `PW_CHROMIUM_PATH`.
