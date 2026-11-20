import { afterEach, expect, test } from 'bun:test';
import { applyThemeState, defaultThemeState, theme, withColorOverride } from '../theme';
import { overlayScrollbar } from './scrollbar';

afterEach(() => {
  applyThemeState(defaultThemeState());
});

test('the overlay track paints in the theme background and follows a theme change', () => {
  const options = overlayScrollbar();

  expect(options.trackOptions).toEqual({ backgroundColor: theme.bg, foregroundColor: theme.muted });
  expect(overlayScrollbar()).toBe(options);

  applyThemeState(withColorOverride(defaultThemeState(), 'bg', '#101010'));

  expect(overlayScrollbar().trackOptions?.backgroundColor).toBe('#101010');
});
