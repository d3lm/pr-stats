import type { ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import { useEffect, useRef } from 'react';
import { linkUrl, type LinkTarget } from '../../settings';
import { overlayScrollbar, useScrollbarSettle, wheelStep } from '../hooks/scrollbar';
import { theme } from '../theme';
import type { QueueSection } from '../views/queue';
import type { PrRow } from '../views/rows';

export function QueuePanel({
  heading,
  warning,
  empty,
  sections,
  cursor,
  openIn,
  onRefClick,
}: {
  heading: string | null;
  warning: string | null;
  empty: string | null;
  sections: QueueSection[];
  cursor: number;
  openIn: LinkTarget;
  onRefClick: ((row: PrRow) => void) | null;
}) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { width } = useTerminalDimensions();

  // the renderer reports a click and the end of a selection drag alike, so a click is a release on the press cell
  const lastDown = useRef<{ x: number; y: number } | null>(null);

  useScrollbarSettle(scrollRef, empty === null);

  useEffect(() => {
    scrollRef.current?.scrollChildIntoView(`queue-row-${cursor}`);
  }, [cursor]);

  const header =
    heading === null ? null : (
      <>
        <box height={1}>
          <text wrapMode="none" fg={theme.border}>
            {'─'.repeat(width)}
          </text>
        </box>
        <box height={1} paddingLeft={1} paddingRight={2}>
          <text wrapMode="none">
            <span fg={theme.accent}>▸ </span>
            <b fg={theme.text}>{heading}</b>
          </text>
        </box>
        <box height={1}>
          <text wrapMode="none" fg={theme.border}>
            {'─'.repeat(width)}
          </text>
        </box>
      </>
    );

  if (empty !== null) {
    return (
      <box flexGrow={1} flexDirection="column">
        {header}
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={theme.muted}>{empty}</text>
        </box>
      </box>
    );
  }

  const offsets: { rows: number; lists: number[] }[] = [];

  let total = 0;

  for (const section of sections) {
    const entry = { rows: total, lists: [] as number[] };

    total += section.rows.length;

    for (const list of section.lists) {
      entry.lists.push(total);

      total += list.rows.length;
    }

    offsets.push(entry);
  }

  const renderRow = (row: PrRow, index: number, indent: string) => {
    const isSelected = index === cursor;
    const bg = isSelected ? theme.selectedBg : undefined;

    const parked = row.pending?.snoozed === true || row.mention?.state === 'snoozed' || row.mention?.state === 'read';
    const fg = parked ? theme.muted : theme.text;

    const refStart = indent.length + 2 + row.lead.length + 2;

    return (
      <text
        key={row.url}
        id={`queue-row-${index}`}
        wrapMode="none"
        onMouseDown={
          onRefClick === null
            ? undefined
            : (event) => {
                lastDown.current = event.button === 0 ? { x: event.x, y: event.y } : null;
              }
        }
        onMouseUp={
          onRefClick === null
            ? undefined
            : (event) => {
                const down = lastDown.current;

                lastDown.current = null;

                if (event.button !== 0 || down?.x !== event.x || down.y !== event.y) {
                  return;
                }

                const local = event.currentTarget === null ? -1 : event.x - event.currentTarget.x;

                if (local >= refStart && local < refStart + row.ref.length) {
                  onRefClick(row);
                }
              }
        }
      >
        <span fg={theme.accent}>
          {indent}
          {isSelected ? '▸ ' : '  '}
        </span>
        <span fg={fg} bg={bg}>
          {row.lead}
          {'  '}
        </span>
        {onRefClick === null ? (
          <a href={linkUrl(row.url, openIn)} fg={theme.accent} bg={bg}>
            {row.ref}
          </a>
        ) : (
          <span fg={theme.accent} bg={bg}>
            {row.ref}
          </span>
        )}
        <span fg={fg} bg={bg}>
          {'  '}
        </span>
        {row.mentioned === true && (
          <span fg={theme.accent} bg={bg}>
            {'@ '}
          </span>
        )}
        <span fg={fg} bg={bg}>
          {row.title}
        </span>
        {row.team !== undefined && (
          <span fg={theme.muted} bg={bg}>
            {` · ${row.team}`}
          </span>
        )}
      </text>
    );
  };

  return (
    <box flexGrow={1} flexDirection="column">
      {header}
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        paddingLeft={1}
        paddingRight={2}
        scrollAcceleration={wheelStep}
        verticalScrollbarOptions={overlayScrollbar()}
      >
        {warning !== null && (
          <text wrapMode="word" fg={theme.warn} marginTop={1}>
            {warning}
          </text>
        )}
        {sections.map((section, sectionIndex) => (
          <box key={section.title} flexDirection="column" marginTop={1}>
            <text wrapMode="none" fg={theme.accent}>
              {section.title}
            </text>
            {section.rows.map((row, rowIndex) => renderRow(row, offsets[sectionIndex].rows + rowIndex, ''))}
            {section.lists.map((list, listIndex) => (
              <box key={list.title} flexDirection="column" marginTop={listIndex > 0 ? 1 : 0}>
                <text wrapMode="none" fg={theme.accent}>
                  {'  '}
                  {list.title}
                </text>
                {list.rows.map((row, rowIndex) =>
                  renderRow(row, offsets[sectionIndex].lists[listIndex] + rowIndex, '  '),
                )}
              </box>
            ))}
          </box>
        ))}
      </scrollbox>
    </box>
  );
}
