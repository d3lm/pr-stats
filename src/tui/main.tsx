import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './App';
import { bootstrap } from './bootstrap';
import { runJsonStats } from './data/export';

const { initial, saved, noCache, autoReload, reloadInterval, notifications, notifyChannel, copyLinks, theme, json } =
  bootstrap();

/**
 * The --json flag replaces the TUI with one load that prints the stats
 * report to stdout, so the screen never flips to the alternate buffer
 * and the output pipes cleanly. runJsonStats exits the process either
 * way, so nothing below it runs.
 */
if (json) {
  await runJsonStats(initial, noCache);
}

/**
 * OpenTUI's default exitSignals includes SIGPIPE and registers a process
 * listener that destroys the renderer when any of them fires. Node ignores
 * SIGPIPE by default, but attaching any JS listener makes Node deliver it.
 * The copy-links feature used to pipe the link into clipboard helpers
 * whose broken pipes would quit the whole TUI on a click. The copy now
 * goes through OpenTUI's clipboard service without any helper commands,
 * but a write can still hit a broken pipe when stdout is piped and the
 * reader goes away. This set mirrors OpenTUI's default minus SIGPIPE, so
 * a broken pipe falls back to Node's harmless default and surfaces as a
 * plain write error instead of killing the TUI.
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
    initialNotifyChannel={notifyChannel}
    initialCopyLinks={copyLinks}
    initialTheme={theme}
    onQuit={() => {
      renderer.destroy();
      process.exit(0);
    }}
  />,
);
