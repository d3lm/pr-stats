import { useState } from 'react';
import { snoozeMatches, writeSnoozes, type Snooze, type SnoozeTargetKey } from '../../snooze';

export interface SnoozeStore {
  snoozes: Snooze[];
  add: (snooze: Snooze) => boolean;
  remove: (targets: readonly SnoozeTargetKey[]) => boolean;
}

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
