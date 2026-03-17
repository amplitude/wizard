/**
 * MidiTrackBrowser — Searchable MIDI track selector for the Snake game.
 *
 * Shows a filtered list of tracks from freemidi-catalog.ts.
 * Type to filter, arrow keys to navigate, Enter to select.
 * Esc cancels (calls onCancel).
 *
 * Attribution: All tracks from https://freemidi.org
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

const VISIBLE_ROWS = 10;

export interface SelectedTrack {
  title: string;
  artist: string;
  url: string; // direct URL (fallback) or getter URL (freemidi)
  downloadPage?: string; // freemidi step-1 page (cookie grab)
}

function trackToSelected(track: MidiTrack): SelectedTrack {
  const urls = freemidiUrls(track);
  return {
    title: track.title,
    artist: track.artist,
    url: urls.getter,
    downloadPage: urls.downloadPage,
  };
}

function fallbackSelected(): SelectedTrack {
  return {
    title: FALLBACK_TRACK.title,
    artist: FALLBACK_TRACK.artist,
    url: FALLBACK_TRACK.directUrl,
  };
}

interface MidiTrackBrowserProps {
  onSelect: (track: SelectedTrack) => void;
  onCancel: () => void;
}

export const MidiTrackBrowser = ({ onSelect, onCancel }: MidiTrackBrowserProps) => {
  const [query, setQuery] = useState('');
  const scrollRef = useRef(0);
  const sorted = useMemo(
    () => [...MIDI_CATALOG].sort((a, b) => a.title.localeCompare(b.title)),
    [],
  );

  const [focused, setFocused] = useState(() => {
    const defaultIdx = sorted.findIndex((t) => t.id === DEFAULT_TRACK_ID);
    return defaultIdx >= 0 ? defaultIdx : 0;
  });

  const filtered = useMemo(() => {
    if (!query) return sorted;
    const q = query.toLowerCase();
    return sorted.filter(
      (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
    );
  }, [query]);

  // Clamp focused index to filtered list length
  const safeFocused = Math.min(focused, Math.max(0, filtered.length - 1));

  // Scrolling
  if (safeFocused < scrollRef.current) {
    scrollRef.current = safeFocused;
  } else if (safeFocused >= scrollRef.current + VISIBLE_ROWS) {
    scrollRef.current = safeFocused - VISIBLE_ROWS + 1;
  }
  const scrollOffset = scrollRef.current;

  const visible = filtered.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);
  const hasAbove = scrollOffset > 0;
  const hasBelow = scrollOffset + VISIBLE_ROWS < filtered.length;

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      const track = filtered[safeFocused];
      if (track) {
        onSelect(trackToSelected(track));
      } else {
        // If nothing matches, use fallback
        onSelect(fallbackSelected());
      }
      return;
    }

    if (key.upArrow) {
      setFocused((f) => Math.max(0, Math.min(f, filtered.length - 1) - 1));
      return;
    }
    if (key.downArrow) {
      setFocused((f) => Math.min(filtered.length - 1, Math.min(f, filtered.length - 1) + 1));
      return;
    }

    // Text input for search
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setFocused(0);
      scrollRef.current = 0;
      return;
    }

    // Printable characters
    if (input && !key.ctrl && !key.meta && input.length === 1) {
      setQuery((q) => q + input);
      setFocused(0);
      scrollRef.current = 0;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={2} marginBottom={1}>
        <Text bold color={Colors.accent}>Select Track</Text>
        <Text dimColor>attributed to freemidi.org</Text>
      </Box>

      {/* Search box */}
      <Box gap={1} marginBottom={1}>
        <Text dimColor>Search:</Text>
        <Text color={Colors.accent}>{query || ' '}</Text>
        <Text dimColor>▌</Text>
      </Box>

      {/* Results */}
      {filtered.length === 0 ? (
        <Box gap={1}>
          <Text dimColor>No matches.</Text>
          <Text dimColor>Press Esc to cancel or Backspace to clear.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {hasAbove && (
            <Text dimColor>  ↑ {scrollOffset} more</Text>
          )}
          {visible.map((track, i) => {
            const idx = scrollOffset + i;
            const isFocused = idx === safeFocused;
            return (
              <Box key={track.id} gap={1}>
                <Text color={isFocused ? Colors.accent : undefined} dimColor={!isFocused}>
                  {isFocused ? '▶' : ' '}
                </Text>
                <Text
                  color={isFocused ? Colors.accent : undefined}
                  bold={isFocused}
                  dimColor={!isFocused}
                >
                  {track.title}
                </Text>
                <Text dimColor>—</Text>
                <Text dimColor>{track.artist}</Text>
              </Box>
            );
          })}
          {hasBelow && (
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
  );
};
