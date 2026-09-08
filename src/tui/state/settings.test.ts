import { expect, test } from 'bun:test';
import { firstSettingOn, SETTING_PAGES, settingPageOf, SETTINGS } from './settings';
import { initialUiState, uiReducer, type UiState } from './ui';

test('the settings sit page by page in the order of the tab strip', () => {
  /**
   * The flat selection index walks the pages in strip order, so the
   * page of every setting must be the same as or come after the page of
   * the setting before it.
   */
  const pages = SETTINGS.map((_, index) => settingPageOf(index));

  expect(pages).toEqual(pages.toSorted((a, b) => a - b));
  expect(new Set(pages).size).toBe(SETTING_PAGES.length);
});

test('a page switch lands on the first row of the page', () => {
  const state: UiState = { ...initialUiState, modal: 'settings', settingError: 'bad', cacheAction: 'confirm' };

  for (const [page] of SETTING_PAGES.entries()) {
    const next = uiReducer(state, { type: 'settingPageSelected', page });

    expect(next.selectedSetting).toBe(firstSettingOn(page));
    expect(settingPageOf(next.selectedSetting)).toBe(page);
    expect(SETTINGS[next.selectedSetting].page).toBe(SETTING_PAGES[page].key);
  }

  // the switch drops the feedback of the row it leaves
  const switched = uiReducer(state, { type: 'settingPageSelected', page: 1 });

  expect(switched.settingError).toBeNull();
  expect(switched.cacheAction).toBeNull();

  // the digit of the shown page keeps the selected row as it is
  const onLastRow = { ...state, selectedSetting: SETTINGS.length - 1 };

  expect(uiReducer(onLastRow, { type: 'settingPageSelected', page: SETTING_PAGES.length - 1 })).toBe(onLastRow);
});

test('cycling the pages wraps around in both directions', () => {
  let state: UiState = { ...initialUiState, modal: 'settings' };

  const visited = SETTING_PAGES.map(() => {
    state = uiReducer(state, { type: 'settingPageCycled', delta: 1 });

    return settingPageOf(state.selectedSetting);
  });

  expect(visited).toEqual([1, 2, 3, 4, 0]);

  state = uiReducer(state, { type: 'settingPageCycled', delta: -1 });

  expect(settingPageOf(state.selectedSetting)).toBe(SETTING_PAGES.length - 1);
  expect(state.selectedSetting).toBe(firstSettingOn(SETTING_PAGES.length - 1));
});

test('moving the selection past the end of a page crosses onto the next page', () => {
  const lastOnFirstPage = firstSettingOn(1) - 1;
  const state: UiState = { ...initialUiState, modal: 'settings', selectedSetting: lastOnFirstPage };

  const down = uiReducer(state, { type: 'settingSelectionMoved', delta: 1 });

  expect(down.selectedSetting).toBe(firstSettingOn(1));

  const up = uiReducer(down, { type: 'settingSelectionMoved', delta: -1 });

  expect(up.selectedSetting).toBe(lastOnFirstPage);
});
