#!/usr/bin/env bash
# Контактный лист из N равномерно взятых кадров видео.
# Использование: contact-sheet.sh <video> <out.png> [N=12] [start_s] [end_s]
set -euo pipefail
video="$1"; out="$2"; n="${3:-12}"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
start="${4:-0}"; end="${5:-$dur}"
# вертикальное видео: больше колонок, меньше ширина кадра
read -r vw vh < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$video" | tr 'x' ' ')
if [ "$vh" -gt "$vw" ]; then cols=6; sw=360; else cols=4; sw=640; fi
[ "$n" -lt "$cols" ] && cols=$n
rows=$(( (n + cols - 1) / cols ))
fps=$(awk -v n="$n" -v s="$start" -v e="$end" 'BEGIN{printf "%.6f", n/(e-s)}')
ffmpeg -v error -y -ss "$start" -to "$end" -i "$video" \
  -vf "fps=$fps,scale=${sw}:-1,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${rows}" \
  -frames:v 1 "$out" 2>/dev/null || \
ffmpeg -v error -y -ss "$start" -to "$end" -i "$video" \
  -vf "fps=$fps,scale=${sw}:-1,tile=${cols}x${rows}" -frames:v 1 "$out"
echo "$out"
