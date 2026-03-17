/**
 * MusicSettings — In-game music configuration panel for Snake.
 *
 * Two sections (Tab to switch):
 *   Volumes — BGM / Tink / SFX, adjust with ← →
 *   Tracks  — searchable list from freemidi.org
 *
 * Esc / Enter on a track closes and applies changes.
 */

import { Box, Text, useInput } from 'ink';
import { useState, useMemo, useRef } from 'react';
import { Colors } from '../styles.js';
import {
  MIDI_CATALOG,
  FALLBACK_TRACK,
  DEFAULT_TRACK_ID,
  type MidiTrack,
  freemidiUrls,
} from './freemidi-catalog.js';

export interface SelectedTrack {
  title: string;
  artist: string;
  url: string;
  downloadPage?: string;
}

export interface MusicConfig {
  track: SelectedTrack;
  musicVolume: number;
  tinkVolume: number;
  sfxVolume: number;
}

function trackToSelected(track: MidiTrack): SelectedTrack {
  const urls = freemidiUrls(track);
  return { title: track.title, artist: track.artist, url: urls.getter, downloadPage: urls.downloadPage };
}

function fallbackSelected(): SelectedTrack {
  return { title: FALLBACK_TRACK.title, artist: FALLBACK_TRACK.artist, url: FALLBACK_TRACK.directUrl };
}

const VISIBLE_ROWS = 8;
const VOLUME_STEP = 0.1;

function volBar(v: number): string {
  const filled = Math.round(v * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function snap(v: number): number {
  return Math.max(0, Math.min(1, Math.round(v * 10) / 10));
}

type Section = 'volumes' | 'tracks';

const VOICES = [
  { key: 'musicVolume' as const, label: 'Music (BGM)' },
  { key: 'tinkVolume' as const, label: 'Tink (per frame)' },
  { key: 'sfxVolume'  as const, label: 'SFX (eat / die)' },
];

interface MusicSettingsProps {
  initial: MusicConfig;
  onApply: (config: MusicConfig) => void;
  onCancel: () => void;
}

export const MusicSettings = ({ initial, onApply, onCancel }: MusicSettingsProps) => {
  const [section, setSection] = useState<Section>('tracks');
  const [voiceFocus, setVoiceFocus] = useState(0);
  const [volumes, setVolumes] = useState({
    musicVolume: initial.musicVolume,
    tinkVolume: initial.tinkVolume,
    sfxVolume: initial.sfxVolume,
  });
  const [selectedTrack, setSelectedTrack] = useState<SelectedTrack>(initial.track);

  // Track browser state
  const [query, setQuery] = useState('');
  const scrollRef = useRef(0);
  const sorted = useMemo(
    () => [...MIDI_CATALOG].sort((a, b) => a.title.localeCompare(b.title)),
    [],
  );
  const [trackFocus, setTrackFocus] = useState(() => {
    const idx = sorted.findIndex((t) => t.id === DEFAULT_TRACK_ID);
    return idx >= 0 ? idx : 0;
  });
  const filtered = useMemo(() => {
    if (!query) return sorted;
    const q = query.toLowerCase();
    return sorted.filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q));
  }, [query, sorted]);

  const safeFocus = Math.min(trackFocus, Math.max(0, filtered.length - 1));
  if (safeFocus < scrollRef.current) scrollRef.current = safeFocus;
  else if (safeFocus >= scrollRef.current + VISIBLE_ROWS) scrollRef.current = safeFocus - VISIBLE_ROWS + 1;
  const scrollOffset = scrollRef.current;
  const visible = filtered.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);

  const apply = (track: SelectedTrack) => {
    onApply({ track, ...volumes });
  };

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }

    if (key.tab) {
      setSection((s) => s === 'tracks' ? 'volumes' : 'tracks');
      return;
    }

    if (section === 'volumes') {
      if (key.upArrow)   { setVoiceFocus((f) => Math.max(0, f - 1)); return; }
      if (key.downArrow) { setVoiceFocus((f) => Math.min(VOICES.length - 1, f + 1)); return; }
      if (key.leftArrow || key.rightArrow) {
        const voice = VOICES[voiceFocus];
        if (!voice) return;
        const delta = key.leftArrow ? -VOLUME_STEP : VOLUME_STEP;
        setVolumes((v) => ({ ...v, [voice.key]: snap(v[voice.key] + delta) }));
        return;
      }
      if (key.return) { apply(selectedTrack); return; }
    }

    if (section === 'tracks') {
      if (key.return) {
        const track = filtered[safeFocus];
        const sel = track ? trackToSelected(track) : fallbackSelected();
        setSelectedTrack(sel);
        apply(sel);
        return;
      }
      if (key.upArrow)   { setTrackFocus((f) => Math.max(0, Math.min(f, filtered.length - 1) - 1)); return; }
      if (key.downArrow) { setTrackFocus((f) => Math.min(filtered.length - 1, Math.min(f, filtered.length - 1) + 1)); return; }

      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        setTrackFocus(0); scrollRef.current = 0;
        return;
      }
      if (input && !key.ctrl && !key.meta && input.length === 1) {
        setQuery((q) => q + input);
        setTrackFocus(0); scrollRef.current = 0;
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box gap={3} marginBottom={1}>
        <Text bold color={Colors.accent}>Music Settings</Text>
        <Box gap={1}>
          <Text
            bold={section === 'tracks'}
            color={section === 'tracks' ? Colors.accent : undefined}
            dimColor={section !== 'tracks'}
          >
            Tracks
          </Text>
          <Text dimColor>·</Text>
          <Text
            bold={section === 'volumes'}
            color={section === 'volumes' ? Colors.accent : undefined}
            dimColor={section !== 'volumes'}
          >
            Volumes
          </Text>
        </Box>
        <Text dimColor>Tab to switch</Text>
      </Box>

      {section === 'volumes' && (
        <Box flexDirection="column" gap={0}>
          {VOICES.map((voice, i) => {
            const isFocused = i === voiceFocus;
            const val = volumes[voice.key];
            return (
              <Box key={voice.key} gap={2}>
                <Text color={isFocused ? Colors.accent : undefined} dimColor={!isFocused}>
                  {isFocused ? '▶' : ' '}
                </Text>
                <Box width={18}>
                  <Text color={isFocused ? Colors.accent : undefined} dimColor={!isFocused}>
                    {voice.label}
                  </Text>
                </Box>
                <Text color={isFocused ? Colors.accent : undefined} dimColor={!isFocused}>
                  {volBar(val)}
                </Text>
                <Text dimColor>{fmtPct(val)}</Text>
              </Box>
            );
          })}
          <Box marginTop={1} gap={2}>
            <Text dimColor>↑↓ select voice</Text>
            <Text dimColor>← → adjust</Text>
            <Text dimColor>Enter apply</Text>
            <Text dimColor>Esc cancel</Text>
          </Box>
        </Box>
      )}

      {section === 'tracks' && (
        <Box flexDirection="column">
          <Box gap={1} marginBottom={1}>
            <Text dimColor>Now playing:</Text>
            <Text color={Colors.accent}>{selectedTrack.title}</Text>
            <Text dimColor>— {selectedTrack.artist}</Text>
          </Box>
          <Box gap={1} marginBottom={1}>
            <Text dimColor>Search:</Text>
            <Text color={Colors.accent}>{query || ' '}</Text>
            <Text dimColor>▌</Text>
          </Box>
          {filtered.length === 0 ? (
            <Text dimColor>No matches. Backspace to clear.</Text>
          ) : (
            <Box flexDirection="column">
              {scrollOffset > 0 && <Text dimColor>  ↑ {scrollOffset} more</Text>}
              {visible.map((track, i) => {
                const idx = scrollOffset + i;
                const isFocused = idx === safeFocus;
                return (
                  <Box key={track.id} gap={1}>
                    <Text color={isFocused ? Colors.accent : undefined} dimColor={!isFocused}>
                      {isFocused ? '▶' : ' '}
                    </Text>
                    <Text color={isFocused ? Colors.accent : undefined} bold={isFocused} dimColor={!isFocused}>
                      {track.title}
                    </Text>
                    <Text dimColor>— {track.artist}</Text>
                  </Box>
                );
              })}
              {scrollOffset + VISIBLE_ROWS < filtered.length && (
                <Text dimColor>  ↓ {filtered.length - scrollOffset - VISIBLE_ROWS} more</Text>
              )}
            </Box>
          )}
          <Box marginTop={1} gap={2}>
            <Text dimColor>↑↓ navigate</Text>
            <Text dimColor>Enter select</Text>
            <Text dimColor>Esc cancel</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
