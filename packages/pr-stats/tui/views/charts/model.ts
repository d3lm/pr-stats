import { isFullDayMode, timeMode } from '../../../time';

/**
 * One colored run of characters inside a chart line. A missing color means
 * the renderer's default text color.
 */
export interface Span {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
}

export type Line = Span[];

/**
 * One chart block with a bold title, a muted subtitle on the same row, and
 * preformatted colored lines below. A subtitle given as spans can color
 * legend glyphs to match the chart body, and spans without a color render
 * muted like a plain string subtitle.
 */
export interface Card {
  title: string;
  subtitle: string | Line;
  lines: Line[];
}

export function lineLength(line: Line): number {
  return line.reduce((sum, span) => sum + span.text.length, 0);
}

export function cardWidth(card: Card): number {
  const subtitleLength = typeof card.subtitle === 'string' ? card.subtitle.length : lineLength(card.subtitle);

  return Math.max(card.title.length + 2 + subtitleLength, ...card.lines.map(lineLength));
}

/**
 * Formats a duration compactly for chart labels, like 12m, 5.2h, or 2.8d.
 * Days follow the configured working-day length, matching how the report
 * module formats durations.
 */
export function formatDuration(hours: number): string {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }

  if (hours < 2 * timeMode.dayHours) {
    return `${compact(hours)}h`;
  }

  return `${compact(hours / timeMode.dayHours)}${timeMode.business && !isFullDayMode() ? 'wd' : 'd'}`;
}

function compact(value: number): string {
  return String(Math.round(value * 10) / 10);
}
