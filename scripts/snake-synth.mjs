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

const active = new Map();
const notes  = [];

for (let t = 0; t < midi.tracks.length; t++) {
  let tick = 0;
  for (const ev of midi.tracks[t]) {
    tick += ev.deltaTime;
    const key = `${ev.channel}-${ev.noteNumber}`;
    if (ev.type === 'noteOn' && ev.velocity > 0) {
      active.set(key, { startTick: tick, velocity: ev.velocity });
    } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
      const a = active.get(key);
      if (a) {
        notes.push({ startMs: tickToMs(a.startTick), endMs: tickToMs(tick), note: ev.noteNumber, velocity: a.velocity });
        active.delete(key);
      }
    }
  }
}

// ── Synthesize ────────────────────────────────────────────────────────

const totalMs      = Math.max(...notes.map((n) => n.endMs)) + 1000;
const SR           = 22050;
const totalSamples = Math.ceil((totalMs / 1000) * SR);
const mix          = new Float32Array(totalSamples);

function midiToFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

for (const { startMs, endMs, note, velocity } of notes) {
  const startS = Math.floor((startMs / 1000) * SR);
  const durS   = Math.max(Math.floor(((endMs - startMs) / 1000) * SR), 1);
  const rel    = Math.min(Math.floor(SR * 0.08), durS);
  const atk    = Math.min(Math.floor(SR * 0.005), durS);
  const amp    = (velocity / 127) * 0.12;
  const freq   = midiToFreq(note);
  const end    = Math.min(startS + durS + rel, totalSamples);

  for (let i = startS; i < end; i++) {
    const pos = i - startS;
    const env = Math.min(pos / atk, 1) * (pos < durS ? 1 : (durS + rel - pos) / rel);
    const t   = pos / SR;
    mix[i]   += amp * env * (
      Math.sin(2 * Math.PI * freq     * t)       +
      Math.sin(2 * Math.PI * freq * 2 * t) * 0.4 +
      Math.sin(2 * Math.PI * freq * 3 * t) * 0.2
    );
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

const bpm = Math.round(60_000_000 / tempoMap[0].uspb);
process.stdout.write(JSON.stringify({ bpm, durationMs: Math.round(totalMs) }) + '\n');
