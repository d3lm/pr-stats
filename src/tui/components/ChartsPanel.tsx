import type { ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import type { RefObject } from 'react';
import { overlayScrollbar, useScrollbarSettle } from '../hooks/scrollbar';
import { theme } from '../theme';
import { cardWidth, type Card, type Line, type Span } from '../views/charts/model';
import type { StatsView } from '../views/stats';

const COLUMN_GAP = 4;

/**
 * Stats panel shared by the review and size tabs. A pinned strip
 * summarizes how the PRs classified, a pinned scope row names the opened
 * repo with its headline percentiles, and rules above and below the pinned
 * rows frame the header. The scroll area opens one blank line under the
 * header with the full-width distribution strip, pushed down further when
 * a warning or a PR list renders above it, and the chart cards follow in
 * a two-column grid when they fit side by side, paired row by row so each
 * pair top aligns.
 *
 * The pinned rows and the scroll area share the same two-column right
 * padding, so their right-aligned stats land on one edge. The scrollbar
 * overlays the outer padding column and never moves the content.
 */
export function ChartsPanel({
  scrollRef,
  focused,
  heading,
  warning,
  view,
}: {
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  focused: boolean;
  heading: string | null;
  warning: string | null;
  view: StatsView;
}) {
  useScrollbarSettle(scrollRef, view.empty === null);

  const { width } = useTerminalDimensions();

  if (view.empty !== null) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={theme.muted}>{view.empty}</text>
      </box>
    );
  }

  /**
   * The grid deals the cards into rows in order, left cell first, so a
   * conditional card shifts everything after it instead of leaving a
   * hole. Both cards of a row share their top edge and the next row
   * starts below the taller of the two. The final row can hold a single
   * card, whose right slot keeps its fixed width so the columns stay in
   * place.
   */
  const left = view.cards.filter((_, i) => i % 2 === 0);
  const right = view.cards.filter((_, i) => i % 2 === 1);
  const leftWidth = Math.max(0, ...left.map((card) => cardWidth(card)));
  const rightWidth = Math.max(0, ...right.map((card) => cardWidth(card)));
  const twoColumns = right.length > 0 && width - 4 >= leftWidth + COLUMN_GAP + rightWidth;

  const rows = left.map((card, i) => {
    return { key: card.title, left: card, right: right.at(i) };
  });

  const cards = twoColumns ? (
    <box flexDirection="column" rowGap={1}>
      {rows.map((row) => (
        <box key={row.key} flexDirection="row" alignItems="flex-start" columnGap={COLUMN_GAP}>
          <box flexDirection="column" width={leftWidth} flexShrink={0}>
            <ChartCard card={row.left} />
          </box>
          <box flexDirection="column" width={rightWidth} flexShrink={0}>
            {row.right !== undefined && <ChartCard card={row.right} />}
          </box>
        </box>
      ))}
    </box>
  ) : (
    <box flexDirection="column" rowGap={1}>
      {view.cards.map((card) => (
        <ChartCard key={card.title} card={card} />
      ))}
    </box>
  );

  return (
    <box flexGrow={1} flexDirection="column">
      <box height={1}>
        <text wrapMode="none" fg={theme.border}>
          {'─'.repeat(width)}
        </text>
      </box>

      <box height={1} paddingLeft={1} paddingRight={2} flexDirection="row" justifyContent="space-between">
        {keyed(view.strip, lineKey).map(({ key, item }) => (
          <ChartLine key={key} line={item} />
        ))}
      </box>

      {(heading !== null || view.headline !== null) && (
        <box height={1} paddingLeft={1} paddingRight={2} flexDirection="row" justifyContent="space-between">
          <text wrapMode="none">
            {heading !== null && (
              <>
                <span fg={theme.accent}>▸ </span>
                <b fg={theme.text}>{heading}</b>
              </>
            )}
          </text>
          {view.headline !== null && <ChartLine line={view.headline} />}
        </box>
      )}

      <box height={1}>
        <text wrapMode="none" fg={theme.border}>
          {'─'.repeat(width)}
        </text>
      </box>

      <scrollbox
        ref={scrollRef}
        focused={focused}
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

        {view.lists.map((list) => (
          <box key={list.title} flexDirection="column" marginTop={1}>
            <text wrapMode="none" fg={theme.accent}>
              {list.title}
            </text>
            {list.rows.map((row) => (
              <text key={row.url} wrapMode="none" fg={theme.text}>
                {'  '}
                {row.lead}
                {'  '}
                <a href={row.url} fg={theme.accent}>
                  {row.ref}
                </a>
                {'  '}
                {row.title}
              </text>
            ))}
          </box>
        ))}

        {view.distribution !== null && (
          <box flexDirection="column" marginTop={1} marginBottom={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text wrapMode="none">
                <b fg={theme.text}>{view.distributionTitle}</b>
              </text>
              <ChartLine line={view.distribution.stats} />
            </box>
            <box flexDirection="column" marginTop={1}>
              {keyed(view.distribution.lines, lineKey).map(({ key, item }) => (
                <ChartLine key={key} line={item} />
              ))}
            </box>
          </box>
        )}

        {view.cards.length === 0 ? (
          <text wrapMode="none" fg={theme.muted} marginTop={1}>
            {view.noCharts}
          </text>
        ) : (
          cards
        )}
      </scrollbox>
    </box>
  );
}

/**
 * Pairs each item with a render key derived from its content. Duplicate
 * content, like blank spacer lines, gets an occurrence suffix so the keys
 * stay unique.
 */
function keyed<T>(items: T[], contentOf: (item: T) => string): { key: string; item: T }[] {
  const seen = new Map<string, number>();

  return items.map((item) => {
    const content = contentOf(item);
    const count = seen.get(content) ?? 0;

    seen.set(content, count + 1);

    return { key: `${count}:${content}`, item };
  });
}

function spanKey(span: Span): string {
  return `${span.fg ?? ''}|${span.bg ?? ''}|${span.bold === true ? 'b' : ''}|${span.text}`;
}

function lineKey(line: Line): string {
  return line.map((span) => spanKey(span)).join('&');
}

/**
 * Renders one preformatted chart line. Spans without a color fall back to
 * the default text color.
 */
function ChartLine({ line }: { line: Line }) {
  return (
    <text wrapMode="none">
      {keyed(line, spanKey).map(({ key, item }) =>
        item.bold === true ? (
          <b key={key} fg={item.fg ?? theme.text} bg={item.bg}>
            {item.text}
          </b>
        ) : (
          <span key={key} fg={item.fg ?? theme.text} bg={item.bg}>
            {item.text}
          </span>
        ),
      )}
    </text>
  );
}

function ChartCard({ card }: { card: Card }) {
  const subtitle: Line = typeof card.subtitle === 'string' ? [{ text: card.subtitle, fg: theme.muted }] : card.subtitle;

  return (
    <box flexDirection="column">
      <text wrapMode="none">
        <b fg={theme.text}>{card.title}</b>
        <span fg={theme.muted}>{'  '}</span>
        {keyed(subtitle, spanKey).map(({ key, item }) => (
          <span key={key} fg={item.fg ?? theme.muted}>
            {item.text}
          </span>
        ))}
      </text>
      <box flexDirection="column" marginTop={1}>
        {keyed(card.lines, lineKey).map(({ key, item }) => (
          <ChartLine key={key} line={item} />
        ))}
      </box>
    </box>
  );
}
