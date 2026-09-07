import { useState } from 'react';
import { snoozeMatches, writeSnoozes, type Snooze, type SnoozeTargetKey } from '../../snooze';

export interface SnoozeStore {
  /**
   * Holds the snoozes of this session, the ones read from disk at
   * startup plus every change since, expired ones included until the
   * wake-up hook ends them.
   */
  snoozes: Snooze[];
  /**
   * Adds a snooze, replacing an earlier snooze of the same kind on the
   * same PR, and persists the list. Returns false when the cache is
   * disabled and the snooze only lasts the session.
   */
  add: (snooze: Snooze) => boolean;
  /**
   * Ends the snoozes of the given kinds and PR refs and persists the
   * list. Returns false when the cache is disabled and nothing was
   * stored.
   */
  remove: (targets: readonly SnoozeTargetKey[]) => boolean;
}

/**
 * Owns the snoozes of the awaiting-you tab, the review snoozes of the
 * awaiting queue and the mention snoozes of the inbox. Every change
 * lands in the React state, which rebuilds the queue right away, and in
 * the snooze file in the cache directory, so the snoozes survive a
 * restart. The change functions read the list of the render they were
 * created in, which the keyboard handler and the wake-up hook keep
 * current, so a change always builds on the latest committed list.
 */
export function useSnoozes(initial: Snooze[]): SnoozeStore {
  const [snoozes, setSnoozes] = useState(initial);

  const commit = (next: Snooze[]) => {
    setSnoozes(next);

    return writeSnoozes(next);
  };

  return {
    snoozes,
    add: (snooze) => commit([...snoozes.filter((entry) => !snoozeMatches(entry, snooze)), snooze]),
    remove: (targets) => commit(snoozes.filter((entry) => !targets.some((target) => snoozeMatches(entry, target)))),
  };
}
