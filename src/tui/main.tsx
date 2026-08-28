import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './App';
import { bootstrap } from './bootstrap';

const { initial, saved, noCache, copyLinks, theme } = bootstrap();

/**
 * OpenTUI's default exitSignals includes SIGPIPE and registers a process
 * listener that destroys the renderer when any of them fires. Node ignores
 * SIGPIPE by default, but attaching any JS listener makes Node deliver it.
 * The copy-links feature pipes the link into pbcopy/wl-copy/xclip/clip, and
 * a helper that closes its read end early turns that write into a broken
 * pipe, which raises SIGPIPE and would quit the whole TUI on a click. This
 * set mirrors OpenTUI's default minus SIGPIPE, so a broken helper pipe
 * falls back to Node's harmless default and only surfaces as the EPIPE
 * that copyToClipboard already swallows and reports.
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
    initialCopyLinks={copyLinks}
    initialTheme={theme}
    onQuit={() => {
      renderer.destroy();
      process.exit(0);
    }}
  />,
);
