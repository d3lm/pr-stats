import { spawn } from 'node:child_process';

/**
 * Picks the platform's command that writes its stdin to the clipboard.
 * Linux prefers wl-copy on a Wayland session and falls back to xclip,
 * both of which may need installing, unlike pbcopy and clip.
 */
function copyCommand(): { command: string; args: string[] } {
  switch (process.platform) {
    case 'darwin': {
      return { command: 'pbcopy', args: [] };
    }
    case 'win32': {
      return { command: 'clip', args: [] };
    }
    default: {
      if (process.env.WAYLAND_DISPLAY !== undefined && process.env.WAYLAND_DISPLAY !== '') {
        return { command: 'wl-copy', args: [] };
      }

      return { command: 'xclip', args: ['-selection', 'clipboard'] };
    }
  }
}

/**
 * Copies the text to the system clipboard by piping it into the
 * platform's clipboard command. The child is fire and forget, so nothing
 * blocks on it. A spawn failure or a non-zero exit reports through
 * onError instead of tearing down the TUI, so the caller can tell the
 * user the copy failed rather than staying silent.
 */
export function copyToClipboard(text: string, onError: (message: string) => void): void {
  const { command, args } = copyCommand();
  const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });

  child.on('error', (error) => {
    onError(`could not copy the link (${error.message})`);
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      onError(`could not copy the link (${command} exited with ${code})`);
    }
  });

  // a failed spawn also errors the pipe, which the child error already covers
  child.stdin.on('error', () => {});

  child.stdin.end(text);
}
