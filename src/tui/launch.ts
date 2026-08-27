#!/usr/bin/env node

/**
 * Launches the TUI under Bun or Node.js. This file is the published
 * pr-stats binary and the app bundle sits next to it as tui-app.mjs.
 *
 * Bun ships FFI natively, so under Bun the app loads directly. Node.js
 * gates OpenTUI's native rendering behind the --experimental-ffi flag,
 * which cannot be enabled after startup, so the launcher re-executes the
 * app with the flag when it is missing. The re-execution also silences
 * the experimental warning because it would otherwise land in the
 * terminal right before the alternate screen takes over.
 *
 * The launcher stays dependency free and syntactically boring on purpose.
 * It must run far enough on old Node.js versions to print the version
 * requirement instead of a syntax error.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * OpenTUI needs Node.js 26.4.0 or later for its node:ffi backend.
 */
const MIN_NODE_MAJOR = 26;
const MIN_NODE_MINOR = 4;

const appUrl = new URL('tui-app.mjs', import.meta.url);

/**
 * Hands the terminal to the given command and mirrors its exit. Signals
 * sent to the launcher are forwarded so the app can restore the terminal
 * before it dies.
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
 * Reports whether node:ffi is already loadable, which happens when the flag came in through NODE_OPTIONS.
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
    // a too-old Node.js still gets a working TUI when Bun is around
    reexec('bun', [fileURLToPath(appUrl)], () => {
      console.error(
        `pr-stats needs Node.js ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or later, or Bun 1.3 or later. You are running Node.js ${process.versions.node} and no bun binary was found.`,
      );

      process.exit(1);
    });
  } else if (await ffiAvailable()) {
    await import(appUrl.href);
  } else {
    reexec(process.execPath, ['--experimental-ffi', '--disable-warning=ExperimentalWarning', fileURLToPath(appUrl)]);
  }
}
