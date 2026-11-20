import { spawn } from 'node:child_process';

/**
 * The empty string on Windows fills the window-title slot of start, which would otherwise
 * swallow the URL.
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
