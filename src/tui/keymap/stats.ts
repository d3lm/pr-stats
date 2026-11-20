import type { KeyEvent } from '@opentui/core';
import { SCROLL_STEP_ROWS } from '../hooks/scrollbar';
import { activeStatsTab, type StatsTabKey } from '../state/browse';
import type { KeymapContext } from './context';
import { handleRepoPickerKey } from './helpers';

function statsTabOf(context: KeymapContext) {
  const { views } = context;
  const key = activeStatsTab(context.browse);

  if (key === 'merged') {
    return {
      key,
      repos: views?.mergedRepos ?? [],
      scope: views?.mergedScope ?? null,
      view: views?.merged ?? null,
    };
  }

  if (key === 'review') {
    return {
      key,
      repos: views?.reviewRepos ?? [],
      scope: views?.reviewScope ?? null,
      view: views?.review ?? null,
    };
  }

  if (key === 'size') {
    return {
      key,
      repos: views?.sizeRepos ?? [],
      scope: views?.sizeScope ?? null,
      view: views?.size ?? null,
    };
  }

  return {
    key,
    repos: views?.commentRepos ?? [],
    scope: views?.commentScope ?? null,
    view: views?.comments ?? null,
  };
}

function handleStatsScrollKey(key: KeyEvent, tab: StatsTabKey, context: KeymapContext): void {
  switch (key.name) {
    case 'j':
    case 'down': {
      context.scrollBy(tab, SCROLL_STEP_ROWS);

      break;
    }
    case 'k':
    case 'up': {
      context.scrollBy(tab, -SCROLL_STEP_ROWS);

      break;
    }
    case 'pagedown': {
      context.scrollBy(tab, 0.5, 'viewport');

      break;
    }
    case 'pageup': {
      context.scrollBy(tab, -0.5, 'viewport');

      break;
    }
    case 'end': {
      context.scrollBy(tab, 1, 'content');

      break;
    }
    case 'home': {
      context.scrollBy(tab, -1, 'content');

      break;
    }
    default: {
      break;
    }
  }
}

export function handleStatsKey(key: KeyEvent, context: KeymapContext): void {
  const { key: tab, repos, scope, view } = statsTabOf(context);

  if (handleRepoPickerKey(key, tab, repos, scope, context)) {
    return;
  }

  if (key.name === 'x' && view?.expandable === true) {
    context.dispatchBrowse({ type: 'expandToggled', tab });
    return;
  }

  handleStatsScrollKey(key, tab, context);
}
