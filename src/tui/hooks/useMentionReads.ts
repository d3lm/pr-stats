import { useRef, useState } from 'react';
import {
  emptyMentionReads,
  markMentionRead,
  markMentionUnread,
  mentionIdsOf,
  seedMentionReads,
  unseedMentionReads,
  writeMentionReads,
  type MentionMark,
  type MentionReads,
  type MentionReadsByUser,
} from '../../mentions';
import type { RawData } from '../data/load';

export interface MentionReadStore {
  reads: MentionReads;
  observe: (data: RawData) => void;
  markRead: (ref: string, mark: MentionMark) => boolean;
  markAllRead: (marks: readonly { ref: string; mark: MentionMark }[]) => boolean;
  markUnread: (ref: string) => boolean;
}

// a shared instance keeps the view model memo stable across renders
const NO_READS = emptyMentionReads();

interface ReadState {
  all: MentionReadsByUser;
  user: string | null;
}

// changes build on a ref because the loader calls observe from a render that can be several marks old
export function useMentionReads(initial: MentionReadsByUser): MentionReadStore {
  const [state, setState] = useState<ReadState>({ all: initial, user: null });
  const latest = useRef(state);

  const commit = (user: string, apply: (reads: MentionReads) => MentionReads) => {
    const { all } = latest.current;
    const reads = all.get(user) ?? NO_READS;
    const next = apply(reads);
    const changed = next !== reads;

    if (!changed && user === latest.current.user) {
      return true;
    }

    latest.current = { all: changed ? new Map(all).set(user, next) : all, user };

    setState(latest.current);

    return changed ? writeMentionReads(latest.current.all) : true;
  };

  const change = (apply: (reads: MentionReads) => MentionReads) => {
    const { user } = latest.current;

    return user === null ? true : commit(user, apply);
  };

  return {
    reads: state.user === null ? NO_READS : (state.all.get(state.user) ?? NO_READS),
    observe: (data) => {
      commit(data.user.toLowerCase(), (reads) =>
        data.mentions === null
          ? unseedMentionReads(reads)
          : seedMentionReads(reads, {
              at: data.fetchedAt.getTime(),
              ids: data.mentions.flatMap(mentionIdsOf),
            }),
      );
    },
    markRead: (ref, mark) => change((reads) => markMentionRead(reads, ref, mark)),
    markAllRead: (marks) =>
      change((reads) => {
        let next = reads;

        for (const { ref, mark } of marks) {
          next = markMentionRead(next, ref, mark);
        }

        return next;
      }),
    markUnread: (ref) => change((reads) => markMentionUnread(reads, ref)),
  };
}
