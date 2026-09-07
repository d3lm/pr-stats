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
  /**
   * Holds the read state of the login the shown data belongs to, the one
   * read from disk at startup plus every change since. Before any data
   * arrived it is the empty state, which reads every mention as read.
   */
  reads: MentionReads;
  /**
   * Takes the login and the seed from a result list the App shows. The
   * login the load resolved selects whose state the store answers with
   * from then on, so a switch of the account never reads or writes the
   * marks of another. Data with mentions seeds the inbox of that login at
   * its fetch time with the texts it holds when no seed exists yet, so a
   * session starts with an empty inbox and only the mentions after it
   * count as unread. Data without mentions drops the seed, so turning the
   * tracking back on seeds afresh instead of listing everything since the
   * old seed. Persists a change.
   */
  observe: (data: RawData) => void;
  /**
   * Marks the mentions of the given PR up to the given mark as read and
   * persists the change. Returns false when the cache is disabled and
   * the mark only lasts the session.
   */
  markRead: (ref: string, mark: MentionMark) => boolean;
  /**
   * Marks the given PRs read at their given marks in one change and
   * persists it. Returns false when the cache is disabled and the marks
   * only last the session.
   */
  markAllRead: (marks: readonly { ref: string; mark: MentionMark }[]) => boolean;
  /**
   * Marks every mention of the given PR unread and persists the change.
   * Returns false when the cache is disabled and the mark only lasts
   * the session.
   */
  markUnread: (ref: string) => boolean;
}

/**
 * The read state the store answers with before any data named a login
 * and for a login without a state of its own. It is shared across
 * renders so the view model memo sees one value.
 */
const NO_READS = emptyMentionReads();

interface ReadState {
  all: MentionReadsByUser;
  user: string | null;
}

/**
 * Owns the read state of the mention inbox. It holds the state of every
 * login that used this machine and answers with the one of the login
 * the shown data resolved, in lower case the way GitHub compares
 * logins. Every change lands in the React state, which rebuilds the
 * queue right away, and in the read state file in the cache directory,
 * so the inbox survives a restart. The change functions build on a ref
 * that holds the latest change rather than on the state of the render
 * they were created in, because the loader calls observe from the render
 * that started a load, which can be several marks old by the time the
 * load finishes. Every change goes through commit, which keeps the ref
 * and the state in step and only writes the file when a state changed
 * rather than only the login.
 */
export function useMentionReads(initial: MentionReadsByUser): MentionReadStore {
  const [state, setState] = useState<ReadState>({ all: initial, user: null });
  const latest = useRef(state);

  /**
   * Applies a change to the state of the given login and switches the
   * store to that login. A change that returns the state it got leaves
   * the map and the file alone.
   */
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

  /**
   * Applies a change to the state of the current login. Without a login
   * there is no data on screen and nothing to mark, so the change is
   * dropped.
   */
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
