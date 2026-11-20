import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './App';
import { bootstrap } from './bootstrap';
import { runJsonStats } from './data/export';

const {
  initial,
  saved,
  noCache,
  autoReload,
  reloadInterval,
  notifications,
  trackMentions,
  notifyMentions,
  teamReviews,
  notifyTeamReviews,
  teamReviewStats,
  notifyChannel,
  openIn,
  copyLinks,
  snoozeDuration,
  snoozes,
  mentionReads,
  theme,
  json,
} = bootstrap();

// runJsonStats exits the process, so the renderer never takes over the screen
if (json) {
  await runJsonStats(initial, noCache, teamReviewStats);
}

/**
 * Leaves out SIGPIPE, because listening for it makes Node deliver it and a broken stdout pipe
 * destroys the renderer.
 */
const exitSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGABRT', 'SIGHUP', 'SIGBREAK', 'SIGBUS'];

const renderer = await createCliRenderer({ exitOnCtrlC: true, exitSignals });

for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    renderer.destroy();
    process.exit(0);
  });
}

createRoot(renderer).render(
  <App
    initial={initial}
    initialSaved={saved}
    initialNoCache={noCache}
    initialAutoReload={autoReload}
    initialReloadInterval={reloadInterval}
    initialNotifications={notifications}
    initialTrackMentions={trackMentions}
    initialNotifyMentions={notifyMentions}
    initialTeamReviews={teamReviews}
    initialNotifyTeamReviews={notifyTeamReviews}
    initialTeamReviewStats={teamReviewStats}
    initialNotifyChannel={notifyChannel}
    initialOpenIn={openIn}
    initialCopyLinks={copyLinks}
    initialSnoozeDuration={snoozeDuration}
    initialSnoozes={snoozes}
    initialMentionReads={mentionReads}
    initialTheme={theme}
    onQuit={() => {
      renderer.destroy();
      process.exit(0);
    }}
  />,
);
