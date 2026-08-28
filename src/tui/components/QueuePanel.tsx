import type { ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import { useEffect, useRef } from 'react';
import { overlayScrollbar, useScrollbarSettle } from '../hooks/scrollbar';
import { theme } from '../theme';
import type { QueueSection } from '../views/queue';
import type { PrRow } from '../views/rows';

/**
 * Selectable PR list for the two queue tabs, the awaiting-review
 * queue and the open authored PRs. The App owns the cursor and opens
 * the highlighted PR in the browser on Enter, so this only renders the
 * sections and keeps the cursor row visible while scrolling. Each section
 * renders its rows right under its title, or one indented sub-list per
 * repo when the view is grouped. The cursor counts across every row in
 * render order, matching the rows the App navigates. The PR references
 * stay clickable terminal hyperlinks as well, unless the copy-links
 * setting routes clicks to the clipboard instead. The heading names
 * the opened repo scope when the data spans multiple repos, framed by
 * rules like the stats header, and stays away otherwise.
 */
export function QueuePanel({
  heading,
  warning,
  empty,
  sections,
  cursor,
  onRefClick,
}: {
  heading: string | null;
  warning: string | null;
  empty: string | null;
  sections: QueueSection[];
  cursor: number;
  /**
   * Receives the row whose PR reference was clicked while the copy-links
   * setting is on, and is null while links open through the terminal.
   * A handler also drops the terminal hyperlink from the references, so
   * the terminal no longer opens them on its own modifier-click.
   */
  onRefClick: ((row: PrRow) => void) | null;
}) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { width } = useTerminalDimensions();

  /**
   * Holds the cell of the last left-button press, which makes a click
   * detectable as a release on the same cell. The release alone cannot
   * tell a click from the end of a text-selection drag, because the
   * renderer marks both as dragging.
   */
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

  /**
   * Offsets translate a row's position inside its section or sub-list
   * into the flat cursor index across the whole view.
   */
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

    /**
     * The reference starts after the indent, the two-cell cursor marker,
     * the lead, and the two-space gap, all single-cell ASCII, so the
     * columns map one to one onto the characters.
     */
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
        <span fg={theme.text} bg={bg}>
          {row.lead}
          {'  '}
        </span>
        {onRefClick === null ? (
          <a href={row.url} fg={theme.accent} bg={bg}>
            {row.ref}
          </a>
        ) : (
          <span fg={theme.accent} bg={bg}>
            {row.ref}
          </span>
        )}
        <span fg={theme.text} bg={bg}>
          {'  '}
          {row.title}
        </span>
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
        verticalScrollbarOptions={overlayScrollbar}
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
