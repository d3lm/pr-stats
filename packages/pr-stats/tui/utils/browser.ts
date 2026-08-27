import { spawn } from 'node:child_process';

/**
 * Picks the platform's command that opens a URL in the default browser.
 * The empty string on the Windows path fills start's window-title slot,
 * which would otherwise swallow the URL.
 */
function openCommand(url: string): { command: string; args: string[] } {
  switch (process.platform) {
    case 'darwin': {
      return { command: 'open', args: [url] };
    }
    case 'win32': {
      return { command: 'cmd', args: ['/c', 'start', '', url] };
    }
    default: {
      return { command: 'xdg-open', args: [url] };
    }
  }
}

/**
 * Opens the URL in the default browser. The child is detached and fire
 * and forget, so nothing blocks on it. A spawn failure or a non-zero
 * exit reports through onError instead of tearing down the TUI, so the
 * caller can tell the user the open failed rather than staying silent.
 */
export function openInBrowser(url: string, onError: (message: string) => void): void {
  const { command, args } = openCommand(url);
  const child = spawn(command, args, { stdio: 'ignore', detached: true });

  child.on('error', (error) => {
    onError(`could not open the browser (${error.message})`);
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      onError(`could not open the browser (${command} exited with ${code})`);
    }
  });

  child.unref();
}
