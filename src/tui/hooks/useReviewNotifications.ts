import { useRef } from 'react';
import type { ReviewResult } from '../data/load';
import { describeReviewRequests, diffReviewRequests, type RequestBaseline } from '../data/notifications';
import type { Notifier } from '../utils/notify';

/**
 * Turns fresh loads into desktop notifications about review requests.
 * Returns a function the load callback hands every freshly loaded result
 * list together with the fetch params key it was loaded for. The hook
 * keeps the pending requests of the last load as the baseline, so the
 * first load stays quiet and every later one only reports what changed
 * since the one before. A changed key drops the baseline, because a
 * wider window, another repo, or a different review-types filter
 * changes which PRs the results hold without any of them being news.
 * The baseline updates while the setting is off too, so turning it on
 * reports the changes of the next load and not everything since the
 * last time it was on.
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
