/**
 * snake-synth.mjs — General-purpose MIDI → WAV synthesizer for the Snake game.
 *
 * Usage: node snake-synth.mjs <midi-url-or-path> <output.wav>
 * Stdout: JSON { bpm: number, durationMs: number }
 *
 * No hardcoded song data — works with any MIDI file.
 * Uses midi-file (already a project dep) via createRequire for CJS compat.
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { parseMidi } = require('midi-file');

const [, , midiSrc, wavPath] = process.argv;
if (!midiSrc || !wavPath) {
  process.stderr.write('Usage: node snake-synth.mjs <midi-url-or-path> <output.wav>\n');
  process.exit(1);
}

// ── Fetch or read MIDI ────────────────────────────────────────────────

let midiBuffer;
if (midiSrc.startsWith('http://') || midiSrc.startsWith('https://')) {
  const res = await fetch(midiSrc);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${midiSrc}`);
  midiBuffer = Buffer.from(await res.arrayBuffer());
} else {
  midiBuffer = readFileSync(midiSrc);
}

const midi = parseMidi(midiBuffer);
const TPB  = midi.header.ticksPerBeat;

// ── Tempo map ─────────────────────────────────────────────────────────

const tempoMap = [{ tick: 0, uspb: 500000 }];
{
  let tick = 0;
  for (const ev of midi.tracks[0]) {
    tick += ev.deltaTime;
    if (ev.type === 'setTempo') tempoMap.push({ tick, uspb: ev.microsecondsPerBeat });
  }
}

function tickToMs(tick) {
  let ms = 0, prevTick = 0, uspb = 500000;
  for (const entry of tempoMap) {
    if (entry.tick >= tick) break;
    ms += ((entry.tick - prevTick) / TPB) * (uspb / 1000);
    prevTick = entry.tick;
    uspb = entry.uspb;
  }
  return ms + ((tick - prevTick) / TPB) * (uspb / 1000);
}

// ── Collect notes with durations ──────────────────────────────────────

const notes = [];

for (let t = 0; t < midi.tracks.length; t++) {
  // Reset active map per track — tick counters are independent between tracks
  // and a shared map causes cross-track key collisions with wrong end times.
  const active = new Map();
  let tick = 0;
  let lastTick = 0;

  for (const ev of midi.tracks[t]) {
    tick += ev.deltaTime;
    lastTick = tick;
    if (ev.channel === 9) continue; // skip GM percussion channel
    const key = `${ev.channel}-${ev.noteNumber}`;
    if (ev.type === 'noteOn' && ev.velocity > 0) {
      // A second noteOn on same pitch retriggers — close the previous instance first.
      const prev = active.get(key);
      if (prev) notes.push({ startMs: tickToMs(prev.startTick), endMs: tickToMs(tick), note: ev.noteNumber, velocity: prev.velocity, track: t });
      active.set(key, { startTick: tick, velocity: ev.velocity, note: ev.noteNumber });
    } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
      const a = active.get(key);
      if (a) {
        notes.push({ startMs: tickToMs(a.startTick), endMs: tickToMs(tick), note: ev.noteNumber, velocity: a.velocity, track: t });
        active.delete(key);
      }
    }
  }

  // Flush orphaned notes (noteOn with no matching noteOff) at track end.
  for (const a of active.values()) {
    notes.push({ startMs: tickToMs(a.startTick), endMs: tickToMs(lastTick), note: a.note, velocity: a.velocity, track: t });
  }
}

// Find the first track that actually has pitched notes — that's the lead melody.
// (In format-1 MIDI, track 0 is always tempo metadata and has no noteOns, but
// some files have multiple empty preamble tracks before the first instrument.)
const LEAD_TRACK = (() => {
  for (let t = 0; t < midi.tracks.length; t++) {
    if (midi.tracks[t].some((e) => e.type === 'noteOn' && e.velocity > 0 && e.channel !== 9)) {
      return t;
    }
  }
  return -1;
})();

// ── Synthesize ────────────────────────────────────────────────────────

const totalMs      = Math.max(...notes.map((n) => n.endMs)) + 1000;
const SR           = 22050;
const totalSamples = Math.ceil((totalMs / 1000) * SR);
const mix          = new Float32Array(totalSamples);

function midiToFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

// Three detuned oscillators per note: center, −5 cents, +5 cents
// Gives a warm chorus/unison effect without external effects processing.
const DETUNE_CENTS = [-5, 0, 5];
const DETUNE_RATIOS = DETUNE_CENTS.map((c) => Math.pow(2, c / 1200));
const VOICE_AMP = 1 / DETUNE_RATIOS.length; // normalize across voices

for (const { startMs, endMs, note, velocity, track } of notes) {
  const startS = Math.floor((startMs / 1000) * SR);
  const durS   = Math.max(Math.floor(((endMs - startMs) / 1000) * SR), 1);
  const rel    = Math.min(Math.floor(SR * 0.20), durS); // longer release for smoother decay
  const atk    = Math.min(Math.floor(SR * 0.010), durS);
  const leadBoost = track === LEAD_TRACK ? 1.5 : 1.0;
  const amp    = (velocity / 127) * 0.12 * VOICE_AMP * leadBoost;
  const baseFreq = midiToFreq(note);
  const end    = Math.min(startS + durS + rel, totalSamples);

  for (const ratio of DETUNE_RATIOS) {
    const freq = baseFreq * ratio;
    for (let i = startS; i < end; i++) {
      const pos = i - startS;
      const env = Math.min(pos / atk, 1) * (pos < durS ? 1 : (durS + rel - pos) / rel);
      const t   = pos / SR;
      mix[i]   += amp * env * (
        Math.sin(2 * Math.PI * freq     * t)        +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.40 +
        Math.sin(2 * Math.PI * freq * 3 * t) * 0.20 +
        Math.sin(2 * Math.PI * freq * 4 * t) * 0.12 +
        Math.sin(2 * Math.PI * freq * 5 * t) * 0.07
      );
    }
  }
}

let peak = 0;
for (const s of mix) if (Math.abs(s) > peak) peak = Math.abs(s);
const scale = peak > 0 ? 0.9 / peak : 1;

// ── Write WAV (16-bit mono, 22050 Hz) ────────────────────────────────

const dataSize = totalSamples * 2;
const wav      = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0);  wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 2, 28);
wav.writeUInt16LE(2, 32);  wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
for (let i = 0; i < totalSamples; i++)
  wav.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, mix[i] * scale * 32767))), 44 + i * 2);

writeFileSync(wavPath, wav);

// ── Output metadata ───────────────────────────────────────────────────

// Find the dominant BPM — the tempo that lasts the longest across the piece.
// This handles songs with intros, outros, or gradual tempo shifts better than
// just using the first tempo event.
const totalTicks = Math.max(...midi.tracks.map((tr) => {
  let tk = 0; for (const ev of tr) tk += ev.deltaTime; return tk;
}));
let dominantUspb = tempoMap[0].uspb;
let longestDuration = 0;
for (let i = 0; i < tempoMap.length; i++) {
  const end = tempoMap[i + 1]?.tick ?? totalTicks;
  const dur = end - tempoMap[i].tick;
  if (dur > longestDuration) { longestDuration = dur; dominantUspb = tempoMap[i].uspb; }
}
const bpm = Math.round(60_000_000 / dominantUspb);
process.stdout.write(JSON.stringify({ bpm, durationMs: Math.round(totalMs) }) + '\n');
