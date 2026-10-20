#!/usr/bin/env python3
"""Синтез звука для роликов: звуковые эффекты по таймлайну + фоновая музыка. Нужен только numpy.

  python3 sfx.py cues.json out.wav      собрать дорожку по списку событий (его пишет render.mjs из сцен)
  python3 sfx.py --demo out.wav         все звуки подряд — послушать/проверить
  python3 sfx.py --list                 список звуков

Формат cues.json:
  {"duration": 34.2,
   "cues":  [{"t": 0.2, "type": "alarm", "dur": 1.3, "gain": 0.8, "pan": 0}, ...],
   "music": {"style": "lofi", "from": 7.5, "drums": 14.0, "bpm": 86, "gain": 0.5}}
Звуки: alarm click tick snooze whoosh whoosh_down rise thud pop psst pour clink slurp
       chime success sparkle swell bass drip splash slice squish
"""
import json
import sys
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(7)


# ------------------------------------------------------------------ базовые блоки
def ts(dur):
    return np.arange(max(1, int(dur * SR))) / SR


def noise(dur):
    return rng.standard_normal(max(1, int(dur * SR)))


def fft_filter(x, lo=None, hi=None, soft=0.15):
    """Полосовой фильтр через FFT с мягкими краями (soft — доля частоты на переход)."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    m = np.ones_like(f)
    if lo:
        w = max(lo * soft, 1.0)
        m *= np.clip((f - (lo - w)) / (2 * w), 0, 1)
    if hi:
        w = max(hi * soft, 1.0)
        m *= np.clip(((hi + w) - f) / (2 * w), 0, 1)
    return np.fft.irfft(X * m, n)


def band(dur, lo, hi):
    y = fft_filter(noise(dur), lo, hi)
    return y / (np.max(np.abs(y)) + 1e-9)


def sweep(f0, f1, dur, exp=True):
    t = ts(dur)
    k = t / dur
    f = f0 * (f1 / f0) ** k if exp else f0 + (f1 - f0) * k
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def env(n, attack=0.005, decay=0.2, hold=0.0):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = np.where(t < attack + hold, 1.0, np.exp(-(t - attack - hold) / max(decay, 1e-4)))
    return a * d


def fades(x, fin=0.01, fout=0.05):
    n = len(x)
    i, o = int(fin * SR), int(fout * SR)
    if i:
        x[:i] *= np.linspace(0, 1, i)
    if o:
        x[-o:] *= np.linspace(1, 0, o)
    return x


def norm(x, peak=0.9):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def pad_to(x, n):
    return np.pad(x, (0, max(0, n - len(x))))[:n]


# ------------------------------------------------------------------ звуки
def s_alarm(dur=1.4, f=1050):
    """Цифровой будильник: пачки по 4 писка."""
    t = ts(dur)
    tone = sum(np.sin(2 * np.pi * f * k * t) / k for k in (1, 3, 5))
    cyc = t % 0.62
    on = np.zeros_like(t)
    for b in range(4):
        s = b * 0.11
        on = np.maximum(on, ((cyc >= s) & (cyc < s + 0.065)).astype(float))
    on = np.convolve(on, np.ones(96) / 96, mode='same')  # убрать щелчки
    return norm(tone * on, 0.7)


def s_click():
    n = int(0.04 * SR)
    tr = pad_to(band(0.01, 2000, 9000), n) * env(n, 0.0005, 0.002)
    tone = np.sin(2 * np.pi * 1800 * ts(0.04)) * env(n, 0.001, 0.012)
    return norm(tr * 0.7 + tone * 0.5, 0.8)


def s_tick():
    n = int(0.02 * SR)
    return norm(pad_to(band(0.02, 3000, 10000), n) * env(n, 0.0003, 0.0012), 0.6)


def s_snooze():
    b = sweep(720, 420, 0.14) * env(int(0.14 * SR), 0.004, 0.06)
    return norm(np.concatenate([s_click(), b * 0.8]), 0.8)


def _band_sweep(dur, f_from, f_to, shape=1.5):
    t = ts(dur)
    k = t / dur
    centers = np.geomspace(min(f_from, f_to), max(f_from, f_to), 8)
    cur = f_from * (f_to / f_from) ** k
    y = np.zeros_like(t)
    for c in centers:
        bn = band(dur, c * 0.7, c * 1.4)
        w = np.exp(-(np.log(cur / c) ** 2) / 0.18)
        y += bn * w
    return y * np.sin(np.pi * k) ** shape


def s_whoosh(dur=0.6):
    return norm(_band_sweep(dur, 400, 4000), 0.7)


def s_whoosh_down(dur=0.6):
    return norm(_band_sweep(dur, 4000, 300), 0.7)


def s_rise(dur=1.2):
    y = _band_sweep(dur, 200, 6000, shape=0.6) * np.linspace(0.2, 1, len(ts(dur)))
    y += 0.3 * sweep(180, 900, dur) * np.linspace(0, 1, len(ts(dur)))
    return fades(norm(y, 0.7), 0.05, 0.08)


def s_thud():
    n = int(0.45 * SR)
    body = sweep(115, 42, 0.45) * env(n, 0.002, 0.11)
    tr = pad_to(band(0.06, 60, 900), n) * env(n, 0.001, 0.02)
    return norm(np.tanh(2.2 * (body + 0.6 * tr)), 0.95)


def s_pop():
    n = int(0.09 * SR)
    y = sweep(380, 1150, 0.09) * env(n, 0.001, 0.025)
    return norm(y + 0.2 * pad_to(s_click(), n), 0.75)


def s_psst():
    n = int(1.0 * SR)
    ping = (np.sin(2 * np.pi * 3200 * ts(1.0)) + 0.6 * np.sin(2 * np.pi * 4750 * ts(1.0))) * env(n, 0.001, 0.05)
    hiss = band(1.0, 3500, 12000)
    e = env(n, 0.004, 0.22) * 0.75 + env(n, 0.01, 0.6) * 0.25
    return norm(pad_to(s_click(), n) * 0.6 + ping * 0.35 + hiss * e, 0.8)


def s_pour(dur=2.0):
    t = ts(dur)
    n = len(t)
    body = band(dur, 180, 1600)
    lfo = 0.6 + 0.4 * np.convolve(rng.standard_normal(n), np.ones(2400) / 2400, mode='same') * 18
    y = body * np.clip(lfo, 0.2, 1.4) * 0.5
    for _ in range(int(dur * 55)):  # пузырьки
        st = rng.uniform(0, dur - 0.05)
        f = rng.uniform(380, 1250)
        m = int(0.04 * SR)
        b = sweep(f, f * 1.7, 0.04) * env(m, 0.001, 0.01) * rng.uniform(0.15, 0.5)
        i = int(st * SR)
        y[i:i + m] += b[: n - i]
    return fades(norm(y, 0.7), 0.15, 0.35)


def s_clink():
    def hit(a=1.0):
        n = int(0.5 * SR)
        t = ts(0.5)
        y = sum(amp * np.sin(2 * np.pi * f * t) * np.exp(-t / d)
                for f, amp, d in ((2840, 1, .32), (4120, .6, .22), (5630, .4, .16), (7210, .25, .1)))
        return y * a
    y = hit()
    j = int(0.085 * SR)
    y[j:] += hit(0.45)[: len(y) - j]
    return norm(y, 0.6)


def s_slurp(dur=0.9):
    t = ts(dur)
    am = 0.5 + 0.5 * np.sin(2 * np.pi * 21 * t + 3 * np.sin(2 * np.pi * 3 * t))
    y = band(dur, 350, 2600) * am
    y += 0.25 * sweep(260, 520, dur) * am
    return fades(norm(y, 0.6), 0.04, 0.12)


def _bell(f, dur=1.8, amp=1.0):
    t = ts(dur)
    n = len(t)
    y = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d)
            for r, a, d in ((1, 1, 1.6), (2.76, .45, .7), (5.4, .2, .35), (8.93, .1, .18)))
    return y * env(n, 0.002, 99) * amp


def s_chime(f=1318.5):
    return norm(_bell(f), 0.6)


def s_success():
    notes = (1046.5, 1318.5, 1568.0, 2093.0)
    y = np.zeros(int(1.9 * SR))
    for i, f in enumerate(notes):
        b = _bell(f, 1.6, 1 - i * 0.12)
        j = int(i * 0.085 * SR)
        y[j:j + len(b)] += b[: len(y) - j]
    return norm(y, 0.7)


def s_sparkle(dur=0.9):
    y = np.zeros(int((dur + 0.3) * SR))
    for _ in range(int(dur * 22)):
        f = rng.uniform(2600, 7500)
        b = _bell(f, 0.25, rng.uniform(0.2, 0.6))
        j = int(rng.uniform(0, dur) * SR)
        y[j:j + len(b)] += b[: len(y) - j]
    return norm(y, 0.45)


def s_swell(dur=2.6):
    t = ts(dur)
    k = t / dur
    chord = (174.6, 220.0, 261.6, 392.0, 523.3)  # F A C G C — светлый аккорд
    y = np.zeros_like(t)
    open_h = 1 + 9 * k ** 1.3  # «фильтр» открывается: всё больше гармоник
    for f in chord:
        for h in range(1, 11):
            g = np.clip(open_h - h + 1, 0, 1) / h
            y += g * np.sin(2 * np.pi * f * h * t * (1 + 0.002 * h)) * 0.2
    y *= k ** 1.6
    y = fades(y, 0.02, 0.25)
    return norm(y + 0.5 * pad_to(s_sparkle(dur * 0.5), len(y)) * k, 0.75)


def s_bass():
    n = int(0.8 * SR)
    t = ts(0.8)
    y = np.tanh(2.5 * (np.sin(2 * np.pi * 55 * t) + 0.5 * np.sin(2 * np.pi * 110 * t))) * env(n, 0.004, 0.32)
    y += 0.6 * sweep(75, 38, 0.8) * env(n, 0.002, 0.25)
    return norm(y, 0.95)


def s_drip():
    """Капля воды/сока: «плинк» — тон с быстро растущей высотой."""
    n = int(0.16 * SR)
    y = sweep(480, 1550, 0.16) * env(n, 0.001, 0.035)
    return norm(y + 0.15 * pad_to(s_click(), n), 0.7)


def s_splash():
    """Всплеск: шумовой удар, низкий «плюх» и рассыпь мелких капель."""
    n = int(0.9 * SR)
    burst = band(0.9, 300, 6000) * env(n, 0.002, 0.16)
    thump = sweep(160, 60, 0.9) * env(n, 0.002, 0.08)
    y = burst * 0.8 + thump * 0.6
    for _ in range(14):
        b = s_drip() * rng.uniform(0.12, 0.35)
        j = int(rng.uniform(0.04, 0.6) * SR)
        y[j:j + len(b)] += b[: n - j]
    return norm(y, 0.85)


def s_slice():
    """Разрез ножом: короткий свист лезвия + металлический призвук + влажный хруст."""
    n = int(0.6 * SR)
    sw = pad_to(_band_sweep(0.22, 2500, 9000, shape=0.8), n)
    t = ts(0.6)
    ring = (np.sin(2 * np.pi * 3400 * t) + 0.5 * np.sin(2 * np.pi * 5150 * t)) * env(n, 0.001, 0.12)
    wet = band(0.6, 400, 3000) * env(n, 0.005, 0.06) * (0.6 + 0.4 * np.sin(2 * np.pi * 37 * t))
    return norm(sw * 0.7 + ring * 0.25 + np.roll(wet, int(0.12 * SR)) * 0.6, 0.8)


def s_squish():
    """Сочный «хлюп» (мягкая мякоть)."""
    n = int(0.35 * SR)
    t = ts(0.35)
    am = 0.5 + 0.5 * np.sin(2 * np.pi * 26 * t + 2 * np.sin(2 * np.pi * 5 * t))
    y = band(0.35, 250, 1800) * am * env(n, 0.01, 0.1) + 0.3 * sweep(300, 140, 0.35) * env(n, 0.005, 0.08)
    return norm(y, 0.7)


SOUNDS = {
    'alarm': s_alarm, 'click': s_click, 'tick': s_tick, 'snooze': s_snooze, 'whoosh': s_whoosh,
    'whoosh_down': s_whoosh_down, 'rise': s_rise, 'thud': s_thud, 'pop': s_pop, 'psst': s_psst,
    'pour': s_pour, 'clink': s_clink, 'slurp': s_slurp, 'chime': s_chime, 'success': s_success,
    'sparkle': s_sparkle, 'swell': s_swell, 'bass': s_bass,
    'drip': s_drip, 'splash': s_splash, 'slice': s_slice, 'squish': s_squish,
}
WITH_DUR = {'alarm', 'whoosh', 'whoosh_down', 'rise', 'pour', 'slurp', 'sparkle', 'swell'}
REVERB = {'chime', 'success', 'sparkle', 'swell', 'clink', 'pop', 'drip', 'splash'}


# ------------------------------------------------------------------ музыка
NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def hz(name, octave):
    return 440.0 * 2 ** ((NOTE[name] + 12 * (octave + 1) - 69) / 12)


def music_lofi(dur, bpm=86, drums_at=None, gain=0.5):
    """Тёплый лоу-фай: электропиано (Fmaj7–Em7–Dm7–Cmaj7), бас, бит со свингом, винил."""
    beat = 60 / bpm
    n = int(dur * SR)
    L = np.zeros(n)
    R = np.zeros(n)
    chords = [('F', ['F3', 'A3', 'C4', 'E4']), ('E', ['E3', 'G3', 'B3', 'D4']),
              ('D', ['D3', 'F3', 'A3', 'C4']), ('C', ['C3', 'E3', 'G3', 'B3'])]

    def place(buf, x, t0, g=1.0):
        i = int(t0 * SR)
        if i >= n or i + len(x) <= 0:
            return
        x = x[: n - i]
        buf[i:i + len(x)] += x * g

    def ep(f, dur_n, vel):  # электропиано
        t = ts(dur_n)
        m = len(t)
        y = (np.sin(2 * np.pi * f * t) + 0.32 * np.sin(2 * np.pi * 2 * f * t) + 0.08 * np.sin(2 * np.pi * 3 * f * t))
        y *= env(m, 0.012, 1.1) * (1 + 0.12 * np.sin(2 * np.pi * 4.5 * t)) * vel
        return y

    def kick():
        m = int(0.32 * SR)
        return np.tanh(1.8 * sweep(120, 46, 0.32) * env(m, 0.001, 0.11)) + 0.2 * pad_to(s_click(), m)

    def snare():
        m = int(0.25 * SR)
        return band(0.25, 1400, 7000) * env(m, 0.001, 0.07) * 0.8 + np.sin(2 * np.pi * 190 * ts(0.25)) * env(m, 0.001, 0.05) * 0.5

    def hat(v):
        m = int(0.08 * SR)
        return band(0.08, 7000, 15000) * env(m, 0.0005, 0.018) * v

    bars = int(dur / (4 * beat)) + 2
    for b in range(bars):
        t_bar = b * 4 * beat
        root, notes = chords[b % 4]
        for hit_beat, vel in ((0, 0.9), (1.5, 0.55), (3.0, 0.4)):
            for k, nn in enumerate(notes):
                f = hz(nn[:-1], int(nn[-1]))
                y = ep(f, 1.8, vel * (0.9 + 0.1 * rng.random()))
                st = t_bar + hit_beat * beat + k * 0.012  # лёгкий «страм»
                place(L, y, st, 0.16 * (1.1 if k % 2 else 0.9))
                place(R, y, st, 0.16 * (0.9 if k % 2 else 1.1))
        bf = hz(root, 2)
        for bb in (0, 2.5):
            m = int(beat * 1.4 * SR)
            y = (np.sin(2 * np.pi * bf * ts(beat * 1.4)) + 0.25 * np.sin(2 * np.pi * 2 * bf * ts(beat * 1.4))) * env(m, 0.01, 0.5)
            place(L, y, t_bar + bb * beat, 0.32)
            place(R, y, t_bar + bb * beat, 0.32)
        if drums_at is not None and t_bar + 4 * beat > drums_at:
            for i in range(8):  # хэты восьмыми со свингом
                st = t_bar + i * beat / 2 + (0.07 * beat if i % 2 else 0)
                if st >= drums_at:
                    place(L, hat(0.5 if i % 2 else 0.8), st, 0.18)
                    place(R, hat(0.5 if i % 2 else 0.8), st, 0.22)
            for kb in (0, 2, 2.75):
                st = t_bar + kb * beat
                if st >= drums_at:
                    place(L, kick(), st, 0.55)
                    place(R, kick(), st, 0.55)
            for sb in (1, 3):
                st = t_bar + sb * beat
                if st >= drums_at:
                    place(L, snare(), st, 0.3)
                    place(R, snare(), st, 0.3)
    crackle = np.zeros(n)
    idx = rng.integers(0, n, int(dur * 9))
    crackle[idx] = rng.uniform(-1, 1, len(idx))
    crackle = fft_filter(crackle, 1500, 9000) * 0.35 + fft_filter(noise(dur), 2000, 8000) * 0.004
    L += crackle
    R += crackle
    L, R = fft_filter(L, 35, 7000), fft_filter(R, 35, 7000)  # тёплый «лоу-фай» срез
    pk = max(np.max(np.abs(L)), np.max(np.abs(R))) + 1e-9
    return L / pk * gain, R / pk * gain


# ------------------------------------------------------------------ сведение
def reverb_ir(dur=1.4):
    t = ts(dur)
    l = rng.standard_normal(len(t)) * np.exp(-t / 0.35)
    r = rng.standard_normal(len(t)) * np.exp(-t / 0.35)
    l[: int(0.012 * SR)] = 0
    r[: int(0.017 * SR)] = 0
    return l / np.sum(np.abs(l)) * 40, r / np.sum(np.abs(r)) * 40


def fft_conv(x, h):
    n = len(x) + len(h) - 1
    N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(h, N), N)[: len(x)]


def render(spec):
    dur = float(spec['duration'])
    n = int(dur * SR) + 1
    L, R = np.zeros(n), np.zeros(n)
    sendL, sendR = np.zeros(n), np.zeros(n)
    for c in spec.get('cues', []):
        typ = c['type']
        fn = SOUNDS.get(typ)
        if not fn:
            print(f'нет такого звука: {typ}', file=sys.stderr)
            continue
        y = fn(float(c['dur'])) if (typ in WITH_DUR and c.get('dur')) else fn()
        g = float(c.get('gain', 0.8))
        pan = float(c.get('pan', 0.0))
        gl, gr = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
        i = int(float(c['t']) * SR)
        if i >= n:
            continue
        y = y[: n - i] * g
        L[i:i + len(y)] += y * gl
        R[i:i + len(y)] += y * gr
        if typ in REVERB:
            sendL[i:i + len(y)] += y * gl
            sendR[i:i + len(y)] += y * gr
    irl, irr = reverb_ir()
    L += fft_conv(sendL, irl) * 0.22
    R += fft_conv(sendR, irr) * 0.22

    m = spec.get('music')
    if m:
        st = float(m.get('from', 0))
        md = dur - st
        if md > 0.5:
            ml, mr = music_lofi(md, float(m.get('bpm', 86)), (float(m['drums']) - st) if m.get('drums') is not None else None, float(m.get('gain', 0.5)))
            fade = np.ones(len(ml))
            fi = int(1.2 * SR)
            fade[:fi] = np.linspace(0, 1, fi)
            # приглушать музыку под громкими эффектами (sidechain)
            sc = np.convolve(np.abs(L[int(st * SR):int(st * SR) + len(ml)]) + np.abs(R[int(st * SR):int(st * SR) + len(ml)]), np.ones(2400) / 2400, mode='same')
            sc = pad_to(sc, len(ml))
            duck = 1 - 0.45 * np.clip(sc / (np.max(sc) + 1e-9) * 2.2, 0, 1)
            i = int(st * SR)
            k = min(len(ml), n - i)
            L[i:i + k] += (ml * fade * duck)[:k]
            R[i:i + k] += (mr * fade * duck)[:k]

    peak = max(np.max(np.abs(L)), np.max(np.abs(R))) + 1e-9
    L, R = L / peak * 1.25, R / peak * 1.25
    L, R = np.tanh(L) * 0.93, np.tanh(R) * 0.93  # мягкий лимитер
    o = int(0.6 * SR)
    L[-o:] *= np.linspace(1, 0, o)
    R[-o:] *= np.linspace(1, 0, o)
    return L, R


def write_wav(path, L, R):
    data = np.stack([L, R], axis=1)
    pcm = (np.clip(data, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def demo():
    cues, t = [], 0.3
    for name in SOUNDS:
        d = 1.2 if name in WITH_DUR else None
        cues.append({'t': t, 'type': name, 'gain': 0.8, **({'dur': d} if d else {})})
        t += 1.8 if name in ('swell', 'success', 'pour') else 1.3
    return {'duration': t + 6, 'cues': cues, 'music': {'style': 'lofi', 'from': t, 'drums': t + 2, 'bpm': 86, 'gain': 0.5}}


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)
    if a[0] == '--list':
        print(' '.join(SOUNDS))
        sys.exit(0)
    if a[0] == '--demo':
        spec, out = demo(), a[1] if len(a) > 1 else 'sfx-demo.wav'
    else:
        spec, out = json.load(open(a[0], encoding='utf-8')), a[1]
    L, R = render(spec)
    write_wav(out, L, R)
    print(f'{out}: {len(L) / SR:.1f} с, {len(spec.get("cues", []))} событий{", музыка" if spec.get("music") else ""}')
