#!/usr/bin/env node

/**
 * OpenTUI on Node.js needs --experimental-ffi, which only works at startup, so this re-executes the app
 * with it. The file avoids dependencies and new syntax so old Node.js versions reach the version check.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * OpenTUI's node:ffi backend needs Node.js 26.4.0 or later.
 */
const MIN_NODE_MAJOR = 26;
const MIN_NODE_MINOR = 4;

const appUrl = new URL('tui-app.mjs', import.meta.url);

/**
 * Forwards signals so the child can restore the terminal before it exits.
 */
function reexec(command: string, args: string[], onSpawnError?: (error: NodeJS.ErrnoException) => void): void {
  const child = spawn(command, [...args, ...process.argv.slice(2)], { stdio: 'inherit' });

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => child.kill(signal));
  }

  child.on('error', (error: NodeJS.ErrnoException) => {
    if (onSpawnError !== undefined) {
      onSpawnError(error);
      return;
    }

    console.error(`pr-stats failed to start ${command} (${error.code ?? error.message})`);

    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal !== null ? 1 : 0));
  });
}

/**
 * The flag can already be set through NODE_OPTIONS.
 */
async function ffiAvailable(): Promise<boolean> {
  try {
    await import('node:ffi');
    return true;
  } catch {
    return false;
  }
}

if (process.versions.bun) {
  await import(appUrl.href);
} else {
  const [major = 0, minor = 0] = process.versions.node.split('.').map((part) => Number.parseInt(part, 10));

  if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR)) {
    reexec('bun', [fileURLToPath(appUrl)], () => {
      console.error(
        `pr-stats needs Node.js ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or later, or Bun 1.3 or later. You are running Node.js ${process.versions.node} and no bun binary was found.`,
      );

      process.exit(1);
    });
  } else if (await ffiAvailable()) {
    await import(appUrl.href);
  } else {
    // the warning would print just before the alternate screen takes over
    reexec(process.execPath, ['--experimental-ffi', '--disable-warning=ExperimentalWarning', fileURLToPath(appUrl)]);
  }
}
