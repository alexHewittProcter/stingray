#!/usr/bin/env python3
"""The "Launch Stations" PA drum signal — an ORIGINAL modelled recreation (phase 4 follow-up).

Built against docs/briefs/launch-stations-prompt.md (the founder's brief). Nothing here is sampled, transcribed or
derived from episode audio: the pattern grid in the brief is a character sketch, and the drums are modelled (or the
founder's own recordings, with --samples). Deterministic: a fixed seed, no clock, no network.

    python3 tools/launch-stations.py                 # write public/sfx/launch-stations.wav
    python3 tools/launch-stations.py --events        # print every hit (time ms, voice, velocity) and exit
    python3 tools/launch-stations.py --settings      # print the PA chain's settings and exit
    python3 tools/launch-stations.py --samples DIR   # DIR/snare.wav, accent.wav, tenor.wav (rim.wav) replace the models
    python3 tools/launch-stations.py --out PATH      # write somewhere else

Shape: 180 bpm, three 4/4 bars = 12 beats = exactly 4.000 s. The drumming fills the first ~3.65 s (the reference's
3.67 s); the last stroke is on step 42 (3.50 s) and has rung out well before the file ends, which is on the bar — so
the clip retriggers cleanly, and the game adds its own gap between soundings (LEVELS.alertGap, one more bar).

Needs Python 3 with numpy and scipy only.
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SEED = 1963  # the percussion session's year; any fixed number would do
RATE = 48_000

# ── The pattern (brief steps 1–4, 10) ─────────────────────────────────────────────────────────────────────────────

BPM = 180.0
STEP = 60.0 / BPM / 4  # a sixteenth: 83.33 ms
BARS = 3
LENGTH = BARS * 16 * STEP  # 4.000 s — the file is exactly this long, so it lands on the bar
PRE_ROLL = 0.004  # s — the first stroke a hair after 0 so a negative nudge never falls off the front

# One string per bar, a character per sixteenth. Snare: X accent, x normal stroke, . rest. Low: T tenor, . rest.
# Bars 1 and 2 (beats 1–3) follow the brief's sketch; bar 2's beat 4 and bar 3 are this recreation's own cadence:
# a driving beat into a last figure of accents with the tenor under them, ending on two unison strokes and silence.
SNARE = [
    "XxxX" "xxXx" "XxxX" "xXxx",
    "XxXx" "XxxX" "xXXX" "XxxX",
    "xXxX" "XxXx" "X.X." "....",
]
LOW = [
    "T..." "..T." "T..." ".T..",
    "T..." "T..." ".T.T" "T...",
    "...." "T.T." "T.T." "....",
]

# Velocities (0–1): an accent and a normal stroke, before the performer's shaping below.
ACCENT_VEL = 0.92
TAP_VEL = 0.52
TENOR_VEL = 0.82
RIGHT_HAND = 0.035  # hand-to-hand: strict alternating sticking (R on the even sixteenths) lands a touch heavier
VEL_SPREAD = 0.045  # ± random spread per stroke
PHRASE_RISE = 0.06  # the taps climb this much across the signal (urgency), the accents stay near full
# Humanising (brief step 10): the beat strokes are held tight, the in-between sixteenths a little looser.
JITTER_ON_BEAT_MS = 2.0
JITTER_OFF_BEAT_MS = 4.0


def events(rng: np.random.Generator) -> list[tuple[float, str, float]]:
    """Every hit as (time s, voice, velocity), time-ordered. Voices: 'accent', 'snare', 'tenor' (and 'rim' if used)."""
    out: list[tuple[float, str, float]] = []
    total = BARS * 16
    for bar in range(BARS):
        assert len(SNARE[bar]) == 16 and len(LOW[bar]) == 16
        for i in range(16):
            step = bar * 16 + i
            on_beat = i % 4 == 0
            jitter_ms = JITTER_ON_BEAT_MS if on_beat else JITTER_OFF_BEAT_MS
            nudge = float(np.clip(rng.normal(0, jitter_ms / 2), -jitter_ms, jitter_ms)) / 1000
            t = PRE_ROLL + step * STEP + nudge
            hand = RIGHT_HAND if step % 2 == 0 else 0.0
            progress = step / total
            c = SNARE[bar][i]
            if c != ".":
                accent = c == "X"
                base = ACCENT_VEL if accent else TAP_VEL + PHRASE_RISE * progress
                v = base + hand + rng.uniform(-VEL_SPREAD, VEL_SPREAD)
                if bar == BARS - 1 and accent and i >= 8:
                    v = 1.0  # the closing unison strokes: full
                out.append((t, "accent" if accent else "snare", float(np.clip(v, 0.2, 1.0))))
            if LOW[bar][i] == "T":
                # The tenor player is a second drummer: their own small offset from the snare (a flam's width, at most).
                tt = t + float(np.clip(rng.normal(0, 1.2), -2.5, 2.5)) / 1000
                v = TENOR_VEL + rng.uniform(-VEL_SPREAD, VEL_SPREAD) + (0.1 if bar == BARS - 1 and i >= 8 else 0)
                out.append((max(tt, 0.0), "tenor", float(np.clip(v, 0.2, 1.0))))
    out.sort(key=lambda e: e[0])
    return out


# ── The drums (brief step 5): modelled voices ────────────────────────────────────────────────────────────────────

VOICE_SECONDS = 0.14  # every modelled voice is cut (with a fade) inside this — "decay well under 150 ms"

SNARE_SHELL_HZ = 205.0  # the batter head's fundamental
SNARE_MODES = [(1.0, 1.0, 0.030), (1.59, 0.55, 0.020), (2.14, 0.35, 0.014), (2.65, 0.22, 0.010)]  # (ratio, gain, τ s)
SNARE_PITCH_DROP = 0.04  # the head starts this much sharp and settles in ~8 ms (a hard stroke stretches it)
SNARE_WIRES_BAND = (1900.0, 7000.0)  # Hz — the snare wires' rattle
SNARE_WIRES_TAU = 0.028  # s; an accent's wires ring a touch longer (× ACCENT_WIRE_STRETCH) and louder
ACCENT_WIRE_STRETCH = 1.35
STICK_TAU = 0.0012  # s — the hard-stick click: a very short, bright transient
TENOR_HZ = 112.0
TENOR_MODES = [(1.0, 1.0, 0.060), (1.47, 0.45, 0.035), (1.98, 0.25, 0.022)]
RIM_HZ = 1650.0  # optional side-stick click (supported, not used by the pattern above)


def _env(n: int, tau: float, attack: float = 0.0005) -> np.ndarray:
    t = np.arange(n) / RATE
    a = np.clip(t / attack, 0, 1)
    return a * np.exp(-t / tau)


def _cut(x: np.ndarray) -> np.ndarray:
    n = int(VOICE_SECONDS * RATE)
    x = x[:n].copy()
    fade = int(0.02 * RATE)
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    return x


def _modes(f0: float, modes, drop: float, vel: float, rng: np.random.Generator) -> np.ndarray:
    n = int(VOICE_SECONDS * RATE)
    t = np.arange(n) / RATE
    f = f0 * (1 + drop * vel * np.exp(-t / 0.008))
    phase = 2 * np.pi * np.cumsum(f) / RATE
    out = np.zeros(n)
    for ratio, g, tau in modes:
        out += g * np.sin(ratio * phase + rng.uniform(0, 2 * np.pi)) * _env(n, tau)
    return out


def _band(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, [lo, hi], btype="bandpass", fs=RATE, output="sos")
    return signal.sosfilt(sos, x)


def snare_voice(vel: float, accent: bool, rng: np.random.Generator) -> np.ndarray:
    n = int(VOICE_SECONDS * RATE)
    shell = _modes(SNARE_SHELL_HZ * rng.uniform(0.99, 1.01), SNARE_MODES, SNARE_PITCH_DROP, vel, rng)
    tau = SNARE_WIRES_TAU * (ACCENT_WIRE_STRETCH if accent else 1.0)
    wires = _band(rng.standard_normal(n), *SNARE_WIRES_BAND) * _env(n, tau, attack=0.0015)
    wires /= np.max(np.abs(wires)) + 1e-12
    stick = signal.sosfilt(signal.butter(2, 3000, btype="highpass", fs=RATE, output="sos"), rng.standard_normal(n))
    stick = stick * _env(n, STICK_TAU, attack=0.0001)
    stick /= np.max(np.abs(stick)) + 1e-12
    # Harder strokes are brighter: more stick and wire against the shell.
    bright = 0.6 + 0.4 * vel + (0.15 if accent else 0.0)
    x = 0.9 * shell + (0.55 if accent else 0.45) * bright * wires + 0.5 * bright * stick
    return _cut(x / (np.max(np.abs(x)) + 1e-12) * vel)


def tenor_voice(vel: float, rng: np.random.Generator) -> np.ndarray:
    n = int(VOICE_SECONDS * RATE)
    body = _modes(TENOR_HZ * rng.uniform(0.99, 1.01), TENOR_MODES, 0.06, vel, rng)
    thud = signal.sosfilt(signal.butter(2, 900, btype="lowpass", fs=RATE, output="sos"), rng.standard_normal(n))
    thud = thud * _env(n, 0.006)
    thud /= np.max(np.abs(thud)) + 1e-12
    stick = signal.sosfilt(signal.butter(2, 2500, btype="highpass", fs=RATE, output="sos"), rng.standard_normal(n))
    stick = stick * _env(n, STICK_TAU, attack=0.0001)
    stick /= np.max(np.abs(stick)) + 1e-12
    x = body + 0.35 * thud + 0.18 * vel * stick
    return _cut(x / (np.max(np.abs(x)) + 1e-12) * vel)


def rim_voice(vel: float, rng: np.random.Generator) -> np.ndarray:
    n = int(VOICE_SECONDS * RATE)
    click = _band(rng.standard_normal(n), RIM_HZ * 0.7, RIM_HZ * 2.2) * _env(n, 0.004, attack=0.0001)
    tone = np.sin(2 * np.pi * RIM_HZ * np.arange(n) / RATE) * _env(n, 0.012)
    x = click / (np.max(np.abs(click)) + 1e-12) + 0.4 * tone
    return _cut(x / (np.max(np.abs(x)) + 1e-12) * vel)


def load_samples(directory: str) -> dict[str, np.ndarray]:
    """The founder's recordings, if given: mono, resampled to RATE, peak-normalised; velocity becomes gain."""
    out: dict[str, np.ndarray] = {}
    for voice in ("snare", "accent", "tenor", "rim"):
        path = os.path.join(directory, f"{voice}.wav")
        if not os.path.exists(path):
            if voice != "rim":
                sys.exit(f"--samples: {path} is missing (snare.wav, accent.wav and tenor.wav are needed)")
            continue
        rate, data = wavfile.read(path)
        x = data.astype(np.float64)
        if np.issubdtype(data.dtype, np.integer):
            x /= float(np.iinfo(data.dtype).max)
        if x.ndim == 2:
            x = x.mean(axis=1)
        if rate != RATE:
            g = np.gcd(int(rate), RATE)
            x = signal.resample_poly(x, RATE // g, int(rate) // g)
        x = x[: int(0.3 * RATE)]
        fade = min(len(x) // 4, int(0.02 * RATE))
        if fade > 0:
            x[-fade:] *= np.linspace(1, 0, fade) ** 2
        out[voice] = x / (np.max(np.abs(x)) + 1e-12)
    return out


def render_drums(evts, rng: np.random.Generator, samples: dict[str, np.ndarray] | None) -> np.ndarray:
    n = int(round(LENGTH * RATE))
    out = np.zeros(n + int(0.4 * RATE))
    for t, voice, vel in evts:
        if samples is not None:
            src = samples.get(voice, samples["snare"] if voice == "rim" else None)
            x = src * vel**1.4  # a recording's level follows the stroke (a gentle curve: soft strokes stay audible)
        elif voice == "tenor":
            x = tenor_voice(vel, rng)
        elif voice == "rim":
            x = rim_voice(vel, rng)
        else:
            x = snare_voice(vel, voice == "accent", rng)
        i = int(round(t * RATE))
        out[i : i + len(x)] += x
    return out


# ── The 1963 PA chain (brief steps 6–9) ──────────────────────────────────────────────────────────────────────────

HIGHPASS_HZ = 140.0  # 24 dB/oct (4th-order Butterworth): a small paging horn has no bottom
LOWPASS_HZ = 6500.0  # 24 dB/oct
HORN_PEAK_HZ = 2200.0  # the loudspeaker's honk: a broad mid presence bump
HORN_PEAK_DB = 3.5
HORN_PEAK_Q = 0.9
SMEAR_TAPS = [(0.0061, -20.0), (0.0117, -24.0)]  # (s, dB) — a very short early-reflection smear, no reverb tail
TAPE_DRIVE = 2.2  # tanh drive into the "tape": mild saturation (the output is scaled back to the input's peak)
TAPE_MIX = 0.6  # wet share of the saturated signal
COMP_THRESHOLD_DB = -18.0  # moderate compression, feed-forward, on a peak-following envelope
COMP_RATIO = 3.0
COMP_ATTACK_MS = 6.0
COMP_RELEASE_MS = 90.0
COMP_KNEE_DB = 6.0
SOFTEN_MAX_DB = 3.0  # transient softening: up to this much off where the fast envelope leaps over the slow one
SOFTEN_FAST_MS = 0.5
SOFTEN_SLOW_MS = 12.0
HISS_DBFS = -58.0  # RMS of the hiss while the drums sound; gated to silence before the file ends (clean loops)
HISS_GATE_RELEASE_S = 0.05
PEAK_DBFS = -1.0
END_FADE_S = 0.03  # the last few ms faded to true zero (it is silence by then anyway)


def settings_text() -> str:
    return "\n".join(
        [
            "Launch Stations — 1963 PA chain (in order)",
            f"  1. high-pass      {HIGHPASS_HZ:.0f} Hz, 4th-order Butterworth (24 dB/oct)",
            f"  2. low-pass       {LOWPASS_HZ:.0f} Hz, 4th-order Butterworth (24 dB/oct)",
            f"  3. horn presence  +{HORN_PEAK_DB} dB peak at {HORN_PEAK_HZ:.0f} Hz, Q {HORN_PEAK_Q}",
            f"  4. smear          taps {', '.join(f'{d * 1000:.1f} ms @ {g:.0f} dB' for d, g in SMEAR_TAPS)} (no reverb tail)",
            f"  5. tape           tanh, drive {TAPE_DRIVE}, mix {TAPE_MIX:.0%} wet",
            f"  6. compressor     threshold {COMP_THRESHOLD_DB} dBFS, ratio {COMP_RATIO}:1, knee {COMP_KNEE_DB} dB,"
            f" attack {COMP_ATTACK_MS} ms, release {COMP_RELEASE_MS} ms, makeup to peak",
            f"  7. transient soft up to -{SOFTEN_MAX_DB} dB where a {SOFTEN_FAST_MS} ms envelope exceeds a {SOFTEN_SLOW_MS} ms one",
            f"  8. normalise      peak {PEAK_DBFS} dBFS",
            f"  9. hiss           {HISS_DBFS} dBFS RMS, low-passed, gated to the drums ({HISS_GATE_RELEASE_S} s release)",
            f" 10. output         mono, {RATE} Hz, 16-bit, TPDF dither, {LENGTH:.3f} s ({BPM:.0f} bpm, {BARS} bars)",
            f"     seed {SEED}",
        ]
    )


def _db(x: float) -> float:
    return 10 ** (x / 20)


def _follower(x: np.ndarray, attack_s: float, release_s: float) -> np.ndarray:
    a = np.exp(-1 / (attack_s * RATE))
    r = np.exp(-1 / (release_s * RATE))
    env = np.zeros_like(x)
    e = 0.0
    for i, v in enumerate(np.abs(x)):
        c = a if v > e else r
        e = c * e + (1 - c) * v
        env[i] = e
    return env


def _peaking(f0: float, db: float, q: float):
    a = 10 ** (db / 40)
    w = 2 * np.pi * f0 / RATE
    alpha = np.sin(w) / (2 * q)
    b = [1 + alpha * a, -2 * np.cos(w), 1 - alpha * a]
    den = [1 + alpha / a, -2 * np.cos(w), 1 - alpha / a]
    return np.array(b) / den[0], np.array(den) / den[0]


def pa_chain(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    x = signal.sosfilt(signal.butter(4, HIGHPASS_HZ, btype="highpass", fs=RATE, output="sos"), x)
    x = signal.sosfilt(signal.butter(4, LOWPASS_HZ, btype="lowpass", fs=RATE, output="sos"), x)
    b, a = _peaking(HORN_PEAK_HZ, HORN_PEAK_DB, HORN_PEAK_Q)
    x = signal.lfilter(b, a, x)
    smeared = x.copy()
    for delay, g in SMEAR_TAPS:
        d = int(delay * RATE)
        smeared[d:] += _db(g) * x[:-d]
    x = smeared

    peak = np.max(np.abs(x)) + 1e-12
    y = x / peak
    sat = np.tanh(TAPE_DRIVE * y) / np.tanh(TAPE_DRIVE)
    x = ((1 - TAPE_MIX) * y + TAPE_MIX * sat) * peak

    # Compressor: level in dBFS relative to the signal normalised to 0 dBFS peak, so the threshold means what it says.
    norm = x / (np.max(np.abs(x)) + 1e-12)
    env = _follower(norm, COMP_ATTACK_MS / 1000, COMP_RELEASE_MS / 1000)
    lvl = 20 * np.log10(env + 1e-9)
    over = lvl - COMP_THRESHOLD_DB
    k = COMP_KNEE_DB / 2
    gr = np.where(over <= -k, 0.0, np.where(over >= k, over * (1 - 1 / COMP_RATIO), (1 - 1 / COMP_RATIO) * (over + k) ** 2 / (4 * k)))
    x = norm * 10 ** (-gr / 20)

    fast = _follower(x, SOFTEN_FAST_MS / 1000, SOFTEN_FAST_MS / 1000 * 4)
    slow = _follower(x, SOFTEN_SLOW_MS / 1000, SOFTEN_SLOW_MS / 1000 * 4)
    leap = np.clip(20 * np.log10((fast + 1e-9) / (slow + 1e-9)), 0, None)
    soften = np.minimum(leap * 0.5, SOFTEN_MAX_DB)
    x = x * 10 ** (-soften / 20)

    n = int(round(LENGTH * RATE))
    x = x[:n]
    x = x / (np.max(np.abs(x)) + 1e-12) * _db(PEAK_DBFS)

    # Hiss: low-passed white noise at HISS_DBFS RMS, only while the drums sound (a gate on their envelope), so the
    # file's last stretch is digital silence and a retrigger never steps in the noise floor.
    hiss = signal.sosfilt(signal.butter(2, 5000, btype="lowpass", fs=RATE, output="sos"), rng.standard_normal(n))
    hiss = hiss / (np.sqrt(np.mean(hiss**2)) + 1e-12) * _db(HISS_DBFS)
    gate = np.clip(_follower(x, 0.002, HISS_GATE_RELEASE_S) / 0.05, 0, 1)
    x = x + hiss * gate

    fade = int(END_FADE_S * RATE)
    x[-fade:] *= np.linspace(1, 0, fade)
    x = np.clip(x / max(1.0, np.max(np.abs(x)) / _db(PEAK_DBFS)), -1, 1)
    return x


def to_int16(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    lsb = 1 / 32767
    dither = (rng.uniform(-0.5, 0.5, len(x)) + rng.uniform(-0.5, 0.5, len(x))) * lsb
    dither[np.abs(x) < 1e-7] = 0  # true silence stays silent
    return np.clip(np.round((x + dither) * 32767), -32768, 32767).astype(np.int16)


def events_text(evts) -> str:
    rows = ["  #   time ms   step   voice    vel"]
    for k, (t, voice, vel) in enumerate(evts):
        rows.append(f"{k + 1:3d}  {t * 1000:8.1f}  {(t - PRE_ROLL) / STEP:5.2f}   {voice:<7}  {vel:.2f}")
    counts = {v: sum(1 for e in evts if e[1] == v) for v in ("accent", "snare", "tenor", "rim")}
    rows.append(
        f"{len(evts)} hits ({', '.join(f'{k} {c}' for k, c in counts.items() if c)}); {BPM:.0f} bpm; "
        f"last at {evts[-1][0] * 1000:.1f} ms; file {LENGTH * 1000:.1f} ms = {BARS} bars"
    )
    return "\n".join(rows)


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--events", action="store_true", help="print the event list and exit")
    p.add_argument("--settings", action="store_true", help="print the PA chain's settings and exit")
    p.add_argument("--samples", metavar="DIR", help="use DIR/snare.wav, accent.wav, tenor.wav (rim.wav) for the voices")
    p.add_argument("--out", default=os.path.join(here, "..", "public", "sfx", "launch-stations.wav"))
    args = p.parse_args()

    evts = events(np.random.default_rng(SEED))
    if args.events or args.settings:
        if args.events:
            print(events_text(evts))
        if args.settings:
            print(settings_text())
        return

    rng = np.random.default_rng(SEED + 1)
    samples = load_samples(args.samples) if args.samples else None
    x = pa_chain(render_drums(evts, rng, samples), rng)
    pcm = to_int16(x, rng)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    wavfile.write(args.out, RATE, pcm)
    tail = np.flatnonzero(np.abs(pcm) > 0)
    print(
        f"wrote {os.path.relpath(args.out)}: {len(pcm) / RATE:.3f} s, {os.path.getsize(args.out) / 1024:.0f} KB, "
        f"peak {20 * np.log10(np.max(np.abs(pcm)) / 32768):.1f} dBFS, sound ends at {(tail[-1] + 1) / RATE:.3f} s"
    )


if __name__ == "__main__":
    main()
