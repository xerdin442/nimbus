import { BadRequestException } from '@nestjs/common';
import { labelSeats, rowLabel } from './seat-grid';

describe('rowLabel', () => {
  it.each([
    [0, 'A'],
    [7, 'H'],
    [8, 'J'],
    [12, 'N'],
    [13, 'P'],
    [14, 'R'],
    [22, 'Z'],
    [23, 'AA'],
    [24, 'AB'],
    [46, 'BA'],
  ])('skips I, O and Q by default: %i → %s', (index, label) => {
    expect(rowLabel(index)).toBe(label);
  });

  it.each([
    [8, 'I'],
    [25, 'Z'],
    [26, 'AA'],
    [51, 'AZ'],
    [52, 'BA'],
  ])('uses the full alphabet with no skips: %i → %s', (index, label) => {
    expect(rowLabel(index, [])).toBe(label);
  });

  it('skips custom letters, case-insensitively', () => {
    expect(rowLabel(0, ['a', 'B'])).toBe('C');
  });
});

describe('labelSeats', () => {
  it('letters occupied rows and numbers seats left to right, skipping aisles', () => {
    // Row 0: seats in columns 0,1 and 3 (column 2 is an aisle). Row 1 empty. Row 2: one VIP seat.
    const seats = labelSeats(3, 4, [
      { row: 0, column: 3 },
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 2, column: 2, type: 'vip' },
    ]);

    expect(seats).toEqual([
      { gridRow: 0, gridColumn: 0, rowLabel: 'A', number: 1, type: 'standard' },
      { gridRow: 0, gridColumn: 1, rowLabel: 'A', number: 2, type: 'standard' },
      { gridRow: 0, gridColumn: 3, rowLabel: 'A', number: 3, type: 'standard' },
      { gridRow: 2, gridColumn: 2, rowLabel: 'B', number: 1, type: 'vip' },
    ]);
  });

  it('letters rows with the given skips', () => {
    const cells = Array.from({ length: 9 }, (_, row) => ({ row, column: 0 }));

    expect(labelSeats(9, 1, cells).at(-1)?.rowLabel).toBe('J');
    expect(labelSeats(9, 1, cells, []).at(-1)?.rowLabel).toBe('I');
  });

  it('rejects seats outside the grid', () => {
    expect(() => labelSeats(2, 2, [{ row: 2, column: 0 }])).toThrow(
      BadRequestException,
    );
  });

  it('rejects two seats in the same cell', () => {
    expect(() =>
      labelSeats(2, 2, [
        { row: 0, column: 0 },
        { row: 0, column: 0, type: 'vip' },
      ]),
    ).toThrow(BadRequestException);
  });
});
