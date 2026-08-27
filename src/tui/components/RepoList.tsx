import type { ScrollBoxRenderable } from '@opentui/core';
import { useEffect, useRef } from 'react';
import { overlayScrollbar, useScrollbarSettle } from '../hooks/scrollbar';
import { theme } from '../theme';
import type { RepoOption } from '../views/repos';

/**
 * Repo picker shown when the fetched data spans multiple repos. The App
 * owns the cursor and opens the highlighted entry on Enter, so this only
 * renders the rows and keeps the cursor row visible while scrolling. The
 * prompt names what enter opens, because the picker serves the chart tabs
 * and the queue tabs alike.
 */
export function RepoList({
  options,
  cursor,
  prompt = 'Select a repository and press enter to open its charts.',
}: {
  options: RepoOption[];
  cursor: number;
  prompt?: string;
}) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  useScrollbarSettle(scrollRef);

  useEffect(() => {
    scrollRef.current?.scrollChildIntoView(`repo-row-${cursor}`);
  }, [cursor]);

  const labelWidth = Math.max(...options.map((option) => option.label.length));

  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      paddingLeft={1}
      paddingRight={2}
      verticalScrollbarOptions={overlayScrollbar}
    >
      <text wrapMode="none" fg={theme.muted}>
        {prompt}
      </text>
      <box flexDirection="column" marginTop={1}>
        {options.map((option, i) => {
          const isSelected = i === cursor;

          return (
            <text key={option.label} id={`repo-row-${i}`} wrapMode="none">
              <span fg={theme.accent}>{isSelected ? '▸ ' : '  '}</span>
              <span fg={isSelected ? theme.text : theme.muted} bg={isSelected ? theme.selectedBg : undefined}>
                {` ${option.label.padEnd(labelWidth)} `}
              </span>
              <span fg={theme.muted}>
                {'  '}
                {option.detail}
              </span>
            </text>
          );
        })}
      </box>
    </scrollbox>
  );
}
