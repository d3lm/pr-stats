import type { Line } from './model';

export interface Cell {
  ch: string;
  fg?: string;
}

export function blankCells(width: number): Cell[] {
  return Array.from({ length: width }, () => {
    return { ch: ' ' };
  });
}

export function placeText(cells: Cell[], start: number, text: string, fg?: string): void {
  let at = start;

  for (const ch of text) {
    if (at >= 0 && at < cells.length) {
      cells[at] = { ch, fg };
    }

    at += 1;
  }
}

export function mergeCells(cells: Cell[]): Line {
  const line: Line = [];

  for (const cell of cells) {
    const last = line.at(-1);

    if (last !== undefined && last.fg === cell.fg) {
      last.text += cell.ch;
    } else {
      line.push({ text: cell.ch, fg: cell.fg });
    }
  }

  return line;
}

const H_PARTIALS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

/**
 * Paints full cells with a background color so the bar has no gaps between cells.
 */
export function hbar(fraction: number, width: number, color: string): Line {
  const cells = Math.min(fraction, 1) * width;

  let whole = Math.floor(cells);
  let eighth = Math.round((cells - whole) * 8);

  if (eighth === 8) {
    whole += 1;
    eighth = 0;
  }

  if (whole === 0 && eighth === 0 && fraction > 0) {
    eighth = 1;
  }

  const pad = width - whole - (eighth > 0 ? 1 : 0);
  const line: Line = [];

  if (whole > 0) {
    line.push({ text: ' '.repeat(whole), bg: color });
  }

  if (eighth > 0) {
    line.push({ text: H_PARTIALS[eighth], fg: color });
  }

  if (pad > 0) {
    line.push({ text: ' '.repeat(pad) });
  }

  return line;
}
