import { BadRequestException } from '@nestjs/common';
import type { LabeledSeat, SeatCellInput } from '@src/common/types';

/** I, O and Q are easily misread as 1, 0 and O on tickets and row signs. */
export const DEFAULT_SKIPPED_ROW_LETTERS = ['I', 'O', 'Q'];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** With the default skips: 0 → A, 8 → J, 22 → Z, 23 → AA, 24 → AB … */
export const rowLabel = (
  index: number,
  skipLetters: string[] = DEFAULT_SKIPPED_ROW_LETTERS,
): string => {
  const skipped = new Set(skipLetters.map((l) => l.toUpperCase()));
  const letters = [...ALPHABET].filter((l) => !skipped.has(l));

  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / letters.length)) {
    label = letters[(n - 1) % letters.length] + label;
  }
  return label;
};

/**
 * Turns grid cells from the layout editor into labelled seats. Empty cells are aisles/gaps.
 * Rows that contain seats are lettered top to bottom (A, B, …) skipping empty rows, and seats are
 * numbered left to right within their row, so an aisle doesn't leave a gap in the numbering.
 * Letters in `skipRowLetters` are never used for rows.
 */
export function labelSeats(
  rows: number,
  columns: number,
  cells: SeatCellInput[],
  skipRowLetters: string[] = DEFAULT_SKIPPED_ROW_LETTERS,
): LabeledSeat[] {
  const seen = new Set<string>();

  for (const cell of cells) {
    if (cell.row >= rows || cell.column >= columns) {
      throw new BadRequestException(
        `Seat at row ${cell.row}, column ${cell.column} is outside the ${rows}x${columns} grid`,
      );
    }
    const key = `${cell.row}:${cell.column}`;
    if (seen.has(key)) {
      throw new BadRequestException(
        `Two seats at row ${cell.row}, column ${cell.column}`,
      );
    }
    seen.add(key);
  }

  const occupiedRows = [...new Set(cells.map((c) => c.row))].sort(
    (a, b) => a - b,
  );

  return occupiedRows.flatMap((gridRow, rowIndex) =>
    cells
      .filter((c) => c.row === gridRow)
      .sort((a, b) => a.column - b.column)
      .map((cell, seatIndex) => ({
        gridRow,
        gridColumn: cell.column,
        rowLabel: rowLabel(rowIndex, skipRowLetters),
        number: seatIndex + 1,
        type: cell.type ?? 'standard',
      })),
  );
}
