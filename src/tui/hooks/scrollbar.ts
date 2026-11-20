import type { ScrollAcceleration, ScrollBoxOptions, ScrollBoxRenderable } from '@opentui/core';
import { CliRenderEvents } from '@opentui/core';
import { useRenderer } from '@opentui/react';
import type { RefObject } from 'react';
import { useLayoutEffect } from 'react';
import { theme } from '../theme';

type ScrollbarOptions = NonNullable<ScrollBoxOptions['verticalScrollbarOptions']>;

let cachedOverlay: { key: string; options: ScrollbarOptions } | null = null;

/**
 * The overlay claims no column, so the scrollbox reserves the gutter with paddingRight={2}.
 */
export function overlayScrollbar(): ScrollbarOptions {
  const key = `${theme.bg}|${theme.muted}`;

  if (cachedOverlay?.key === key) {
    return cachedOverlay.options;
  }

  cachedOverlay = {
    key,
    options: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      // iTerm2 extends a row's last-cell background into the window margin, so a colored track shows as a wide band
      trackOptions: { backgroundColor: theme.bg, foregroundColor: theme.muted },
    },
  };

  return cachedOverlay.options;
}

export const SCROLL_STEP_ROWS = 4;

class FixedWheelStep implements ScrollAcceleration {
  readonly #rows: number;

  constructor(rows: number) {
    this.#rows = rows;
  }

  tick(): number {
    return this.#rows;
  }

  reset(): void {}
}

export const wheelStep: ScrollAcceleration = new FixedWheelStep(SCROLL_STEP_ROWS);

/**
 * OpenTUI's first layout measures content at twice the viewport height, which flashes a bar on
 * the mount frame, and its slider keeps a minimum-size thumb when the viewport is sized while
 * the content measures zero rows.
 */
export function useScrollbarSettle(scrollRef: RefObject<ScrollBoxRenderable | null>, mounted = true): void {
  const renderer = useRenderer();

  useLayoutEffect(() => {
    if (!mounted) {
      return undefined;
    }

    if (!scrollRef.current?.verticalScrollBar) {
      return undefined;
    }

    scrollRef.current.verticalScrollBar.visible = false;

    const release = () => {
      renderer.off(CliRenderEvents.FRAME, release);
      scrollRef.current?.verticalScrollBar.resetVisibilityControl();
    };

    const resyncThumb = () => {
      const bar = scrollRef.current?.verticalScrollBar;

      if (!bar) {
        return;
      }

      const height = bar.viewportSize;
      const wanted = Math.max(1, height);

      if (bar.scrollSize < wanted || bar.slider.viewPortSize === wanted) {
        return;
      }

      // writing zero first raises the slider's max to the full scroll size, so the real height passes its clamp
      bar.viewportSize = 0;
      bar.viewportSize = height;
    };

    renderer.on(CliRenderEvents.FRAME, release);
    renderer.on(CliRenderEvents.FRAME, resyncThumb);

    return () => {
      renderer.off(CliRenderEvents.FRAME, release);
      renderer.off(CliRenderEvents.FRAME, resyncThumb);
    };
  }, [scrollRef, renderer, mounted]);
}
