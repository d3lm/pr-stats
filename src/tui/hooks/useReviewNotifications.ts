import { useRef } from 'react';
import type { ReviewResult } from '../data/load';
import { describeReviewRequests, diffReviewRequests, type RequestBaseline } from '../data/notifications';
import type { Notifier } from '../utils/notify';

/**
 * The baseline updates while notifications are off, so turning them on does not report everything since.
 */
export function useReviewNotifications(
  enabled: boolean,
  notify: Notifier,
  onError: (message: string) => void,
  includeTeam = false,
): (key: string, results: ReviewResult[]) => void {
  const baselineRef = useRef<{ key: string; baseline: RequestBaseline } | null>(null);

  return (key, results) => {
    const previous = baselineRef.current?.key === key ? baselineRef.current.baseline : null;
    const changes = diffReviewRequests(previous, results, includeTeam);

    baselineRef.current = { key, baseline: changes.baseline };

    if (!enabled) {
      return;
    }

    for (const notification of describeReviewRequests(changes)) {
      notify(notification.title, notification.body, onError);
    }
  };
}
