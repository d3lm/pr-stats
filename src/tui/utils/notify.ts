import { spawn } from 'node:child_process';
import type { NotifyChannel } from '../../settings';

/**
 * Sends one desktop notification and reports a failure through onError.
 * The App sends the review-request notifications through it and the
 * settings dialog its test notification. Tests inject a recorder here
 * so nothing reaches the real desktop.
 */
export type Notifier = (title: string, body: string, onError: (message: string) => void) => void;

/**
 * The slice of OpenTUI's renderer the notifier reads, the trigger that
 * asks the terminal to post a notification and the capability flag that
 * reports whether a notification protocol was detected.
 */
export interface RendererNotificationBoundary {
  readonly capabilities: { notifications: boolean } | null;
  triggerNotification(message: string, title?: string): boolean;
}

/**
 * Builds the notifier the App uses when no override comes in, honoring
 * the notification channel setting. The terminal path goes through the
 * OSC sequence OpenTUI selected for the detected terminal, which covers
 * iTerm2, Kitty, Ghostty, WezTerm, and most VTE-based terminals. The
 * terminal posts under its own notification permission and the sequence
 * travels through SSH, so that path needs no setup on the machine. A
 * false return from the trigger means no protocol was selected, either
 * because the terminal has none or because detection is still running
 * right after startup. On auto the send then falls back to the platform
 * command, while a forced terminal channel reports the miss instead,
 * because the user chose that path over the fallback. Editor terminals
 * like the one in VS Code render the terminal path as an in-window
 * toast, so forcing the command channel there buys a real system
 * notification.
 */
export function createNotifier(renderer: RendererNotificationBoundary, channel: NotifyChannel): Notifier {
  return (title, body, onError) => {
    if (channel !== 'command' && renderer.triggerNotification(body, title)) {
      return;
    }

    if (channel === 'terminal') {
      onError('the terminal has no notification support, switch the channel to auto or the platform command');
      return;
    }

    sendNotification(title, body, onError);
  };
}

/**
 * Names the channel a send would take right now given the channel
 * setting, terminal or the platform command, or null where the send
 * would land on a platform without a command. The settings dialog shows
 * it on the test row. Detection runs asynchronously after startup, so
 * the auto value can flip to terminal shortly after launch.
 */
export function notificationChannel(renderer: RendererNotificationBoundary, channel: NotifyChannel): string | null {
  if (channel === 'terminal' || (channel === 'auto' && renderer.capabilities?.notifications === true)) {
    return 'terminal';
  }

  return notificationTool();
}

/**
 * Names the command the fallback shells out to on this platform, or
 * null where none exists.
 */
export function notificationTool(): string | null {
  switch (process.platform) {
    case 'darwin': {
      return 'osascript';
    }
    case 'linux': {
      return 'notify-send';
    }
    default: {
      return null;
    }
  }
}

/**
 * Escapes the characters Pango markup treats specially. Some Linux
 * notification servers, GNOME's among them, render the body as markup,
 * so a PR title like "fix <Button> focus" would lose its tag or fail to
 * show without this.
 */
function escapeMarkup(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Picks the platform's notification command. Both commands ship with the
 * platform or its desktop, so nothing needs installing on a typical
 * machine. The macOS path hands the strings to the script as arguments
 * instead of quoting them into AppleScript source, and the title comes
 * first, where it ends the option parsing before a body could start
 * with a dash. The sound name makes the notification audible next to
 * the banner. The Linux path ends the options with -- for the same
 * argument-parsing reason.
 */
function notifyCommand(title: string, body: string): { command: string; args: string[] } | null {
  switch (process.platform) {
    case 'darwin': {
      return {
        command: 'osascript',
        args: [
          '-e',
          'on run argv',
          '-e',
          'display notification (item 2 of argv) with title (item 1 of argv) sound name "default"',
          '-e',
          'end run',
          title,
          body,
        ],
      };
    }
    case 'linux': {
      return { command: 'notify-send', args: ['--app-name=pr-stats', '--', title, escapeMarkup(body)] };
    }
    default: {
      return null;
    }
  }
}

/**
 * Sends a desktop notification through the platform command, the
 * fallback for terminals without a notification protocol. The child is
 * detached and fire and forget, so nothing blocks on it. A missing
 * command, a spawn failure, or a non-zero exit reports through onError
 * instead of tearing down the TUI, so the caller can tell the user the
 * notification failed rather than staying silent. The macOS command
 * posts through the built-in Script Editor, which since macOS 15 needs
 * notification permission before anything shows up, and the README
 * names the one-time steps to grant it.
 */
export function sendNotification(title: string, body: string, onError: (message: string) => void): void {
  const spec = notifyCommand(title, body);

  if (spec === null) {
    onError('desktop notifications are not supported on this platform');
    return;
  }

  const child = spawn(spec.command, spec.args, { stdio: 'ignore', detached: true });

  child.on('error', (error) => {
    onError(`could not send the notification (${error.message})`);
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      onError(`could not send the notification (${spec.command} exited with ${code})`);
    }
  });

  child.unref();
}
