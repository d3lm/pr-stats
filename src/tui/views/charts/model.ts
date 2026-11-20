import { isFullDayMode, timeMode } from '../../../time';

export interface Span {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
}

export type Line = Span[];

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
