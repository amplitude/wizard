/**
 * Table — Aligned column display for Ink.
 *
 * Renders a header row, separator, and data rows using Box/Text.
 * Auto-sizes columns to fit content, capped at optional max widths.
 */

import { Box, Text } from 'ink';
import { Colors, Icons } from '../styles.js';

export interface TableColumn {
  /** Key to look up in each data row. */
  key: string;
  /** Display label for the header. */
  label: string;
  /** Maximum column width. Defaults to unlimited. */
  maxWidth?: number;
}

interface TableProps {
  columns: TableColumn[];
  data: Record<string, string>[];
}

function computeWidths(
  columns: TableColumn[],
  data: Record<string, string>[],
): number[] {
  return columns.map((col) => {
    const headerLen = col.label.length;
    const maxData = data.reduce(
      (max, row) => Math.max(max, (row[col.key] ?? '').length),
      0,
    );
    const natural = Math.max(headerLen, maxData);
    return col.maxWidth ? Math.min(natural, col.maxWidth) : natural;
  });
}

function pad(text: string, width: number): string {
  return text.length >= width
    ? text.slice(0, width)
    : text + ' '.repeat(width - text.length);
}

export const Table = ({ columns, data }: TableProps) => {
  const widths = computeWidths(columns, data);
  const gap = 2;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box gap={gap}>
        {columns.map((col, i) => (
          <Text key={col.key} bold color={Colors.heading}>
            {pad(col.label, widths[i])}
          </Text>
        ))}
      </Box>

      {/* Separator */}
      <Box gap={gap}>
        {columns.map((col, i) => (
          <Text key={col.key} color={Colors.border}>
            {Icons.dash.repeat(widths[i])}
          </Text>
        ))}
      </Box>

      {/* Data rows */}
      {data.map((row, ri) => (
        <Box key={ri} gap={gap}>
          {columns.map((col, ci) => (
            <Text key={col.key} color={Colors.body}>
              {pad(row[col.key] ?? '', widths[ci])}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
};
