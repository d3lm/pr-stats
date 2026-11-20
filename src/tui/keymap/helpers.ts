import type { KeyEvent } from '@opentui/core';
import type { BrowseTabKey, PanelScope } from '../state/browse';
import type { RepoOption } from '../views/repos';
import type { KeymapContext } from './context';

export function digitIndex(key: KeyEvent, items: readonly unknown[]): number {
  return items.findIndex((_, index) => key.name === String(index + 1));
}

export function stepOf(key: KeyEvent): 1 | -1 {
  return key.name === 'left' ? -1 : 1;
}

export function cycled<T>(items: readonly T[], current: T, step: 1 | -1): T {
  const index = items.indexOf(current);

  return items[(index + step + items.length) % items.length];
}

export function entryAt<T>(items: readonly T[], cursor: number): T {
  return items[Math.min(cursor, items.length - 1)];
}

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
      default: {
        break;
      }
    }

    return true;
  }

  if ((key.name === 'escape' || key.name === 'backspace') && repos.length > 0) {
    context.dispatchBrowse({ type: 'pickerReturned', tab });

    return true;
  }

  return false;
}
