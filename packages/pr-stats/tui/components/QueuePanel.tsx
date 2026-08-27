import type { ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import { useEffect, useRef } from 'react';
import { overlayScrollbar, useScrollbarSettle } from '../hooks/scrollbar';
import { theme } from '../theme';
import type { PrList } from '../views/rows';

/**
 * Selectable PR list for the two queue tabs, the awaiting-review queue
 * and the open authored PRs. The App owns the cursor and opens the
 * highlighted PR in the browser on Enter, so this only renders the rows
 * and keeps the cursor row visible while scrolling. The cursor counts
 * across every list in order, matching the rows the App navigates. The
 * PR references stay clickable terminal hyperlinks as well. The heading
 * names the opened repo scope when the data spans multiple repos, framed
 * by rules like the stats header, and stays away otherwise.
 */
export function QueuePanel({
  heading,
  warning,
  empty,
  lists,
  cursor,
}: {
  heading: string | null;
  warning: string | null;
  empty: string | null;
  lists: PrList[];
  cursor: number;
}) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { width } = useTerminalDimensions();

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
   * Offsets translate a row's position inside its list into the flat
   * cursor index across all lists.
   */
  const offsets: number[] = [];

  let total = 0;

  for (const list of lists) {
    offsets.push(total);
    total += list.rows.length;
  }

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
        {lists.map((list, listIndex) => (
          <box key={list.title} flexDirection="column" marginTop={1}>
            <text wrapMode="none" fg={theme.accent}>
              {list.title}
            </text>
            {list.rows.map((row, rowIndex) => {
              const index = offsets[listIndex] + rowIndex;
              const isSelected = index === cursor;
              const bg = isSelected ? theme.selectedBg : undefined;

              return (
                <text key={row.url} id={`queue-row-${index}`} wrapMode="none">
                  <span fg={theme.accent}>{isSelected ? '▸ ' : '  '}</span>
                  <span fg={theme.text} bg={bg}>
                    {row.lead}
                    {'  '}
                  </span>
                  <a href={row.url} fg={theme.accent} bg={bg}>
                    {row.ref}
                  </a>
                  <span fg={theme.text} bg={bg}>
                    {'  '}
                    {row.title}
                  </span>
                </text>
              );
            })}
          </box>
        ))}
      </scrollbox>
    </box>
  );
}
