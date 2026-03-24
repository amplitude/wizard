/**
 * KagiSmallWebViewer — Recent posts from the Kagi Small Web feed.
 *
 * Fetches from the Kagi Atom feed on mount.
 * Each post has a [1]–[0] numeral; typing it opens the post in the browser.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { xml2js } from 'xml-js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors } from '../styles.js';

const FEED_URL = 'https://kagi.com/api/v1/smallweb/feed/?limit=100';

interface SmallWebEntry {
  title: string;
  url: string;
  author: string;
  published: string;
  summary: string;
}

function parseAtom(xml: string): SmallWebEntry[] {
  const root = xml2js(xml, { compact: true }) as Record<string, unknown>;
  const feed = root['feed'] as Record<string, unknown> | undefined;
  if (!feed) return [];

  const rawEntries = feed['entry'];
  const entries: Record<string, unknown>[] = Array.isArray(rawEntries)
    ? (rawEntries as Record<string, unknown>[])
    : rawEntries
    ? [rawEntries as Record<string, unknown>]
    : [];

  return entries.map((e) => {
    const text = (node: unknown): string => {
      if (!node) return '';
      const n = node as Record<string, unknown>;
      return (n['_text'] as string | undefined) ?? '';
    };
    const attr = (node: unknown, key: string): string => {
      if (!node) return '';
      const n = node as Record<string, unknown>;
      const attrs = n['_attributes'] as Record<string, string> | undefined;
      return attrs?.[key] ?? '';
    };

    return {
      title: text(e['title'] as Record<string, unknown> | undefined),
      url: attr(e['link'] as Record<string, unknown> | undefined, 'href'),
      author: text(
        (e['author'] as Record<string, unknown> | undefined)?.['name'],
      ),
      published: text(e['published'] as Record<string, unknown> | undefined),
      summary: text(e['summary'] as Record<string, unknown> | undefined),
    };
  });
}

export const KagiSmallWebViewer = () => {
  const [entries, setEntries] = useState<SmallWebEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(FEED_URL);
        const xml = await res.text();
        const all = parseAtom(xml);
        const shuffled = all.sort(() => Math.random() - 0.5).slice(0, 10);
        setEntries(shuffled);
      } catch {
        // Silently fail — tab stays empty
      }
      setLoading(false);
    })();
  }, []);

  useScreenInput((input) => {
    const num = parseInt(input, 10);
    if (isNaN(num)) return;
    const index = num === 0 ? 9 : num - 1;
    const entry = entries[index];
    if (!entry) return;
    void import('child_process').then(({ exec }) => {
      exec(
        `open "${entry.url}" 2>/dev/null || xdg-open "${entry.url}" 2>/dev/null`,
      );
    });
  });

  if (loading) {
    return (
      <Box paddingX={1}>
        <Text color={Colors.muted}>Loading Kagi Small Web...</Text>
      </Box>
    );
  }

  if (entries.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={Colors.muted}>Could not load Kagi Small Web.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={Colors.accent}>
        Kagi Small Web
      </Text>
      <Box height={1} />
      {entries.map((entry, i) => {
        const key = i === 9 ? '0' : String(i + 1);
        const date = new Date(entry.published);
        const dateStr = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        const host = (() => {
          try {
            return new URL(entry.url).hostname;
          } catch {
            return '';
          }
        })();

        return (
          <Box key={entry.url} flexDirection="column">
            <Box>
              <Text color={Colors.accent} bold>
                [{key}]
              </Text>
              <Text bold> {entry.title}</Text>
            </Box>
            <Box marginLeft={4}>
              <Text color={Colors.muted}>
                {entry.author || host}
                {dateStr ? `, ${dateStr}` : ''}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};
