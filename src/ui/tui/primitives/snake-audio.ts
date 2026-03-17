/**
 * snake-audio.ts — Audio for the Snake game.
 *
 * Background music: synthesizes a MIDI file to WAV via a self-contained
 * child script (snake-synth.mjs, ~1s), then streams it with afplay.
 * Zero runtime npm dependencies — pure Node.js + afplay (macOS built-in).
 *
 * Per-note tink: pre-generated sine-wave WAVs for the chord-per-tick overlay.
 * System sounds: macOS .aiff files for eat / die events.
 *
 * freemidi.org requires a two-step fetch:
 *   1. GET download page → grab PHPSESSID cookie
 *   2. GET getter URL with Cookie + Referer headers → raw MIDI bytes
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOUNDS_DIR = join(tmpdir(), 'wizard-snake-sounds');

// snake-synth.mjs lands at dist/ via the postbuild cp scripts/** dist step
const SYNTH_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../../../snake-synth.mjs');

function wavCachePath(midiUrl: string): string {
  const name = midiUrl.split('/').pop()?.replace(/\W/g, '_') ?? 'midi';
  return join(tmpdir(), `wizard-snake-${name}.wav`);
}

// ── freemidi.org two-step MIDI fetch ─────────────────────────────────

/**
 * Fetch MIDI bytes from freemidi.org.
 * Step 1: GET the download page to obtain a PHPSESSID cookie.
 * Step 2: GET the getter URL with the cookie and Referer header.
 * Falls back to a direct fetch if no downloadPage is provided.
 */
async function fetchMidiBytes(midiUrl: string, downloadPage?: string): Promise<Buffer> {
  if (!downloadPage) {
    const res = await fetch(midiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${midiUrl}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Step 1: get session cookie
  const pageRes = await fetch(downloadPage, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
  });
  const setCookie = pageRes.headers.get('set-cookie') ?? '';
  const sessionMatch = /PHPSESSID=([^;,\s]+)/.exec(setCookie);
  const cookie = sessionMatch ? `PHPSESSID=${sessionMatch[1]}` : '';

  // Step 2: fetch the MIDI
  const midiRes = await fetch(midiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      ...(cookie ? { Cookie: cookie } : {}),
      Referer: downloadPage,
    },
    redirect: 'follow',
  });
  if (!midiRes.ok) throw new Error(`HTTP ${midiRes.status} fetching MIDI from ${midiUrl}`);
  return Buffer.from(await midiRes.arrayBuffer());
}

// ── Background music ─────────────────────────────────────────────────

export interface BgMusicHandle {
  proc: ChildProcess;
  bpm: number;
}

/**
 * Synthesize + play the given MIDI URL in the background.
 * WAV is cached in /tmp keyed to the URL — synthesis only runs once per URL.
 * Returns { proc, bpm } so the caller can kill playback and sync to the tempo.
 *
 * @param midiUrl      Direct URL or freemidi.org getter URL.
 * @param downloadPage freemidi.org download page URL (for cookie grab). Optional.
 */
export async function startBgMusic(
  midiUrl: string,
  downloadPage?: string,
): Promise<BgMusicHandle | null> {
  if (process.platform !== 'darwin') return null;

  const wavPath = wavCachePath(midiUrl);
  let bpm = 120;

  try {
    if (!existsSync(wavPath)) {
      // Write MIDI to a temp file so snake-synth.mjs can read it
      const midiBytes = await fetchMidiBytes(midiUrl, downloadPage);
      const midiTmp = wavPath.replace(/\.wav$/, '.mid');
      writeFileSync(midiTmp, midiBytes);

      const meta = await new Promise<{ bpm: number }>((resolve, reject) => {
        let stdout = '';
        const proc = spawn('node', [SYNTH_SCRIPT, midiTmp, wavPath], { stdio: ['ignore', 'pipe', 'ignore'] });
        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.on('exit', (code) => {
          if (code !== 0) { reject(new Error(`synth exited ${code ?? 'null'}`)); return; }
          try { resolve(JSON.parse(stdout) as { bpm: number }); } catch { resolve({ bpm: 120 }); }
        });
        proc.on('error', reject);
      });
      bpm = meta.bpm;
    }
    const proc = spawn('afplay', [wavPath, '-v', '0.4'], { stdio: 'ignore' });
    return { proc, bpm };
  } catch {
    return null;
  }
}

export function stopBgMusic(handle: BgMusicHandle | null): void {
  handle?.proc.kill();
}

// ── Per-note fallback (sine-wave WAVs via afplay) ─────────────────────

const SAMPLE_RATE = 44100;
const DURATION_S  = 0.09;

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function buildWav(freq: number): Buffer {
  const numSamples = Math.floor(SAMPLE_RATE * DURATION_S);
  const dataSize   = numSamples * 2;
  const buf        = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);

  const fadeIn  = Math.floor(SAMPLE_RATE * 0.005);
  const fadeOut = Math.floor(SAMPLE_RATE * 0.02);
  for (let i = 0; i < numSamples; i++) {
    const env = Math.min(i / fadeIn, 1) * Math.min((numSamples - i) / fadeOut, 1);
    buf.writeInt16LE(Math.round(28000 * env * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)), 44 + i * 2);
  }
  return buf;
}

function noteFile(note: number): string { return join(SOUNDS_DIR, `note-${note}.wav`); }

export function warmNotes(notes: number[]): void {
  mkdirSync(SOUNDS_DIR, { recursive: true });
  for (const note of [...new Set(notes)]) {
    const path = noteFile(note);
    if (!existsSync(path)) writeFileSync(path, buildWav(midiToFreq(note)));
  }
}

export function playNote(note: number, volume = 1): void {
  if (process.platform !== 'darwin') { process.stdout.write('\x07'); return; }
  const path = noteFile(note);
  if (!existsSync(path)) { mkdirSync(SOUNDS_DIR, { recursive: true }); writeFileSync(path, buildWav(midiToFreq(note))); }
  spawn('afplay', [path, '-v', String(volume)], { detached: true, stdio: 'ignore' }).unref();
}

// ── System sounds ─────────────────────────────────────────────────────

export function playSystemSound(file: string, volume = 1): void {
  if (process.platform !== 'darwin') { process.stdout.write('\x07'); return; }
  spawn('afplay', [file, '-v', String(volume)], { detached: true, stdio: 'ignore' }).unref();
}

export const SYSTEM_SOUNDS = {
  eat: '/System/Library/Sounds/Glass.aiff',
  die: '/System/Library/Sounds/Funk.aiff',
};
