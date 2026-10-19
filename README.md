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
- `scripts/render.mjs` — HTML → MP4 (детерминированный рендер)
- `scripts/contact-sheet.sh` — контактный лист кадров для анализа
- `scripts/check-env.sh` — проверка node / playwright / ffmpeg
- `references/` — контракт анимации, рубрика оценки, шаблон HTML

## Установка
Скопируйте репозиторий в `~/.claude/skills/html-video-variants/` (или `.claude/skills/` проекта).
Нужны `node`, `playwright` (с Chromium) и `ffmpeg`.

## Пример
```bash
node scripts/render.mjs references/template.html --out demo.mp4 --duration 4 --fps 30
bash scripts/contact-sheet.sh demo.mp4 demo-sheet.png 12
```
Если Chromium лежит не в стандартном месте, задайте `PW_CHROMIUM_PATH`.
