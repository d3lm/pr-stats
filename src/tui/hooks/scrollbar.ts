import type { ScrollBoxOptions, ScrollBoxRenderable } from '@opentui/core';
import { CliRenderEvents } from '@opentui/core';
import { useRenderer } from '@opentui/react';
import type { RefObject } from 'react';
import { useLayoutEffect } from 'react';

/**
 * Takes a scrollbox's vertical scrollbar out of the layout flow by
 * pinning it over the right edge. An in-flow scrollbar claims a column of
 * viewport width whenever it appears, which shifts every right-aligned
 * row in the scroll area the moment the overflow check turns the bar on.
 * The overlaid bar leaves the viewport width alone, so content renders at
 * its final position from the first frame and the bar simply fades in
 * over the gutter when the content overflows.
 *
 * Every scrollbox that uses this must reserve the gutter itself with
 * paddingRight={2}, one column that the bar covers and one blank column
 * that keeps a gap between the content and the bar.
 */
export const overlayScrollbar: ScrollBoxOptions['verticalScrollbarOptions'] = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
};

/**
 * Keeps a scrollbox's vertical scrollbar hidden through the mount frame.
 * The first layout pass after a scrollbox mounts measures the content at
 * twice the viewport height, so the mount frame would paint a scrollbar
 * even when the content fits, and the corrected pass right after would
 * take it away again as a visible flicker.
 *
 * The bar is manually hidden at commit, before the renderer paints the
 * mount frame, and control returns to the automatic overflow check on the
 * first frame event after that paint. Handing control back may briefly
 * recompute from the mismeasured sizes, but that only schedules another
 * render, and the corrective layout in that render fixes the sizes before
 * anything paints, so a wrong bar never reaches the screen. Overflowing
 * content therefore shows its bar one frame after mount, and fitting
 * content never shows one. Keying the release off the frame event rather
 * than a timer keeps the bar from lagging behind the content.
 *
 * Pass mounted=false while the scrollbox is not rendered. The gate
 * re-arms when the flag flips back to true, which covers scrollboxes
 * that appear after their parent component mounted.
 *
 * The hook also keeps the scrollbar's thumb sized to the real viewport,
 * working around an OpenTUI bug in the slider inside the bar. The slider's
 * viewPortSize setter clamps against its own max, which is still zero when
 * a layout pass sizes the viewport while the content measures zero rows,
 * so the viewport size collapses to the setter's 0.01 floor. The bar only
 * re-pushes the value when the viewport height changes, which it never does
 * again, so the thumb sticks at its minimum size no matter how little the
 * content overflows. The repair in resyncThumb runs on every rendered frame
 * and re-pushes the value once the slider disagrees with the bar, so it also
 * heals the related clamp bug where a resize leaves less scroll range than
 * viewport and the setter truncates the value.
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

    /**
     * Detects a slider whose viewport size diverged from the bar's and
     * re-pushes it through the bar's setter pair. Writing zero first
     * raises the slider's max to the full scroll size, so the restore
     * write passes the buggy clamp unharmed and lands the exact
     * viewport height. Both writes happen between frames, so no
     * intermediate state ever paints, and the guard keeps steady
     * frames free of writes and render requests.
     */
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
