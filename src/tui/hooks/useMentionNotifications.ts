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

/**
 * Turns loads into desktop notifications about mentions of you, the
 * counterpart of useReviewNotifications for the mention entries. Returns
 * a function the loader callbacks hand every result list the App shows,
 * the startup snapshot first and then every fresh load, together with
 * the key of the fetch params and the login it was loaded for and the
 * time the load read GitHub. The hook keeps the texts every list so far
 * mentioned you in as the baseline, so the first list only records what
 * is there and every later one reports the texts that arrived since the
 * one before.
 *
 * The baseline persists in the cache directory after every list, and the
 * first list of a session restores it when it was built for the same
 * key and the restore flag is set, which the App clears for a noCache
 * start so the baseline follows the same policy as the startup snapshot
 * and the first load then only records what is there. The baseline still
 * gets written in that mode, like the snapshot, so the next session
 * without the flag continues from it. A restore makes a session continue
 * where the previous one stopped. That
 * keeps the cutoffs of the PRs the last load could not read and the
 * texts of PRs that had dropped out of the results, both of which the
 * startup snapshot alone would lose, and it makes the first fresh load
 * report the mentions since the previous session even without a
 * snapshot. Diffing the snapshot against the restored baseline changes
 * nothing when both come from the same load, and reports the mentions
 * of a load whose baseline never got written. Without a persisted
 * baseline the snapshot seeds it the way it did before.
 *
 * A list without mention data, from a load that ran while the setting
 * was off, drops the baseline in memory and on disk, so the first load
 * after turning the setting on starts from scratch and reports nothing.
 * Reporting against a stale baseline from before the setting went off
 * would count every mention since then as new, which is the flood the
 * null baseline prevents. A changed key drops the baseline too, because
 * a wider window, another repo, or another account changes which PRs
 * the results hold without any of them being news.
 *
 * The function reads the enabled flag and the notifier of the render it
 * was created in, the same way the review hook does, so a load that was
 * already in flight when the setting flipped still follows the setting
 * it started under.
 */
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
