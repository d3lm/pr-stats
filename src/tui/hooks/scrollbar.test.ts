import { afterEach, expect, test } from 'bun:test';
import { applyThemeState, defaultThemeState, theme, withColorOverride } from '../theme';
import { overlayScrollbar } from './scrollbar';

afterEach(() => {
  applyThemeState(defaultThemeState());
});

test('the overlay track paints in the theme background and follows a theme change', () => {
  const options = overlayScrollbar();

  // only the thumb shows, so the track never draws a band of its own color along the edge
  expect(options.trackOptions).toEqual({ backgroundColor: theme.bg, foregroundColor: theme.muted });

  // the same object comes back while the colors hold, so the reconciler has nothing to re-apply
  expect(overlayScrollbar()).toBe(options);

  applyThemeState(withColorOverride(defaultThemeState(), 'bg', '#101010'));

  expect(overlayScrollbar().trackOptions?.backgroundColor).toBe('#101010');
});
