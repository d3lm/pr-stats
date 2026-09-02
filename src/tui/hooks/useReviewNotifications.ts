import { useRef } from 'react';
import type { ReviewResult } from '../data/load';
import { describeReviewRequests, diffReviewRequests, type RequestBaseline } from '../data/notifications';
import type { Notifier } from '../utils/notify';

/**
 * Turns loads into desktop notifications about review requests. Returns
 * a function the loader callbacks hand every result list the App shows,
 * the startup snapshot first and then every fresh load, together with
 * the fetch params key it was loaded for. The hook keeps the pending
 * requests of the last list as the baseline, so the first list only
 * records what is waiting and every later one reports what changed
 * since the one before. With a snapshot that means the first fresh load
 * reports what changed since the previous session, and only a session
 * without one, after a --no-cache start or on the very first run, keeps
 * its first load quiet. The snapshot seeds the baseline whatever its
 * age, because it is the data the user last saw, and the notification
 * text folds any number of changes into at most two notifications, so
 * an old snapshot cannot flood the desktop either. A changed key drops
 * the baseline, because a wider window, another repo, or a different
 * review-types filter changes which PRs the results hold without any of
 * them being news. The baseline updates while the setting is off too,
 * so turning it on reports the changes of the next load and not
 * everything since the last time it was on.
 *
 * The function reads the enabled flag and the notifier of the render
 * it was created in, the same way the reload reads its options, so a
 * load that was already in flight when the setting flipped still
 * follows the setting it started under.
 */
export function useReviewNotifications(
  enabled: boolean,
  notify: Notifier,
  onError: (message: string) => void,
): (key: string, results: ReviewResult[]) => void {
  const baselineRef = useRef<{ key: string; baseline: RequestBaseline } | null>(null);

  return (key, results) => {
    const previous = baselineRef.current?.key === key ? baselineRef.current.baseline : null;
    const changes = diffReviewRequests(previous, results);

    baselineRef.current = { key, baseline: changes.baseline };

    if (!enabled) {
      return;
    }

    for (const notification of describeReviewRequests(changes)) {
      notify(notification.title, notification.body, onError);
    }
  };
}
