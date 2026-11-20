import { useRef } from 'react';
import type { MentionEntry } from '../data/load';
import {
  describeMentions,
  diffMentions,
  loadMentionBaseline,
  saveMentionBaseline,
  type MentionBaseline,
} from '../data/notifications';
import type { Notifier } from '../utils/notify';

export function useMentionNotifications(
  enabled: boolean,
  notify: Notifier,
  onError: (message: string) => void,
  restore: boolean,
): (key: string, mentions: MentionEntry[] | null, observedAt: Date) => void {
  const baselineRef = useRef<{ key: string; baseline: MentionBaseline } | null>(null);
  const restoredRef = useRef(!restore);

  return (key, mentions, observedAt) => {
    if (!restoredRef.current) {
      restoredRef.current = true;

      const restored = loadMentionBaseline(key);

      if (restored !== null) {
        baselineRef.current = { key, baseline: restored };
      }
    }

    if (mentions === null) {
      baselineRef.current = null;

      saveMentionBaseline(key, null);

      return;
    }

    const previous = baselineRef.current?.key === key ? baselineRef.current.baseline : null;
    const changes = diffMentions(previous, mentions, observedAt);

    baselineRef.current = { key, baseline: changes.baseline };

    saveMentionBaseline(key, changes.baseline);

    if (!enabled) {
      return;
    }

    for (const notification of describeMentions(changes)) {
      notify(notification.title, notification.body, onError);
    }
  };
}
