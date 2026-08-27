import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './App';
import { bootstrap } from './bootstrap';

const { initial, saved, noCache, copyLinks, theme } = bootstrap();

const renderer = await createCliRenderer({ exitOnCtrlC: true });

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
