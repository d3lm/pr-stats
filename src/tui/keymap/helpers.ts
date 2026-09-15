import type { KeyEvent } from '@opentui/core';
import type { BrowseTabKey, PanelScope } from '../state/browse';
import type { RepoOption } from '../views/repos';
import type { KeymapContext } from './context';

/**
 * Returns the position the pressed digit picks in the given list, so a
 * 1 picks the first entry and a 3 the third, or -1 when the key is not
 * a digit that names an entry. The main tabs and the settings pages
 * both select this way.
 */
export function digitIndex(key: KeyEvent, items: readonly unknown[]): number {
  return items.findIndex((_, index) => key.name === String(index + 1));
}

/**
 * Returns the step a left or right press moves a cycling row by, where
 * left goes back and every other key, enter and space included, goes
 * forward.
 */
export function stepOf(key: KeyEvent): 1 | -1 {
  return key.name === 'left' ? -1 : 1;
}

/**
 * Steps through the list by one from the current entry, wrapping at
 * both ends.
 */
export function cycled<T>(items: readonly T[], current: T, step: 1 | -1): T {
  const index = items.indexOf(current);

  return items[(index + step + items.length) % items.length];
}

/**
 * Returns the entry a cursor rests on, clamped to the last entry when
 * the list shrank under the cursor since the last move.
 */
export function entryAt<T>(items: readonly T[], cursor: number): T {
  return items[Math.min(cursor, items.length - 1)];
}

/**
 * Drives the repo picker a tab opens on when the data spans several
 * repos, and reports whether the picker took the key. While the picker
 * shows, up and down move its cursor, enter opens the highlighted repo,
 * and every other key is swallowed. Once a repo is open, escape and
 * backspace return to the picker, and every other key falls through to
 * the tab's own handler.
 */
export function handleRepoPickerKey(
  key: KeyEvent,
  tab: BrowseTabKey,
  repos: readonly RepoOption[],
  scope: PanelScope | null,
  context: KeymapContext,
): boolean {
  if (scope?.view === 'list') {
    switch (key.name) {
      case 'up':
      case 'k': {
        context.dispatchBrowse({ type: 'repoCursorMoved', tab, delta: -1, count: repos.length });

        break;
      }
      case 'down':
      case 'j': {
        context.dispatchBrowse({ type: 'repoCursorMoved', tab, delta: 1, count: repos.length });

        break;
      }
      case 'return': {
        const { repo } = entryAt(repos, context.browse.repoCursors[tab]);

        context.dispatchBrowse({ type: 'repoOpened', tab, repo });

        break;
      }

      // no default
    }

    return true;
  }

  if ((key.name === 'escape' || key.name === 'backspace') && repos.length > 0) {
    context.dispatchBrowse({ type: 'pickerReturned', tab });

    return true;
  }

  return false;
}
