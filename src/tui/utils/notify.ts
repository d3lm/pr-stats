import type { CliRenderer } from '@opentui/core';
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
 * Describes the slice of OpenTUI's renderer the notifier reads.
 * The trigger asks the terminal to post a notification, the capabilities
 * carry the flag that reports whether a notification protocol was
 * selected and the name of the detected terminal, and writeOut puts
 * raw bytes on the renderer's output path, which the bell channel uses.
 */
export interface RendererNotificationBoundary {
  readonly capabilities: { notifications: boolean; terminal: { name: string } } | null;
  triggerNotification(message: string, title?: string): boolean;
  writeOut(data: string): void;
}

/**
 * Narrows OpenTUI's renderer to the boundary the notifier reads. The
 * renderer keeps writeOut private in its typings while using it itself
 * for the terminal title and the background reset, so this is the one
 * place that reaches past the typings. Going through it matters because
 * the native output thread writes the frames, and a bell written
 * straight to stdout could land inside a frame, where the BEL byte ends
 * an OSC 8 hyperlink early. Should a later OpenTUI drop the method, the
 * bell falls back to stdout instead of throwing.
 */
export function notificationBoundary(renderer: CliRenderer): RendererNotificationBoundary {
  const raw = renderer as unknown as { writeOut?: (data: string) => unknown };

  return {
    get capabilities() {
      return renderer.capabilities;
    },
    triggerNotification: (message, title) => renderer.triggerNotification(message, title),
    writeOut: (data) => {
      if (typeof raw.writeOut === 'function') {
        raw.writeOut(data);
      } else {
        process.stdout.write(data);
      }
    },
  };
}

/**
 * Holds the BEL control byte, which every terminal turns into its bell.
 */
const BELL = '\u0007';

type TerminalQuirk = 'iterm' | 'apple-terminal';

/**
 * Names the terminals that handle the notification sequence in a way
 * OpenTUI cannot see, or returns null for a terminal that behaves the
 * way its detection reports. iTerm2 accepts OSC 9 but drops it unless
 * the profile has Notification Center Alerts turned on, which is off by
 * default, and it advertises notification support either way. Apple
 * Terminal gets the same sequence selected for it from its name while
 * it never implemented the notification, so the sequence vanishes there
 * without a trace. The name comes from the XTVERSION reply or from
 * TERM_PROGRAM, so it reads iTerm2 or iTerm.app for the one and
 * Apple_Terminal for the other.
 */
function terminalQuirk(renderer: RendererNotificationBoundary): TerminalQuirk | null {
  const name = renderer.capabilities?.terminal.name ?? '';

  if (/iterm/i.test(name)) {
    return 'iterm';
  }

  if (/apple_terminal|terminal\.app/i.test(name)) {
    return 'apple-terminal';
  }

  return null;
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
 * because the user chose that path over the fallback. Auto also skips
 * the terminal on Apple Terminal, which swallows the sequence OpenTUI
 * picks for it, so the command is the only path that shows anything
 * there. Editor terminals like the one in VS Code render the terminal
 * path as an in-window toast, so forcing the command channel there buys
 * a real system notification. The bell channel rings the terminal bell
 * instead of posting text, which reaches every terminal, including the
 * ones that swallow notifications, and leaves the details to the queue.
 */
export function createNotifier(renderer: RendererNotificationBoundary, channel: NotifyChannel): Notifier {
  return (title, body, onError) => {
    if (channel === 'bell') {
      renderer.writeOut(BELL);
      return;
    }

    const tryTerminal = channel === 'terminal' || (channel === 'auto' && terminalQuirk(renderer) !== 'apple-terminal');

    if (tryTerminal && renderer.triggerNotification(body, title)) {
      return;
    }

    if (channel === 'terminal') {
      onError('the terminal has no notification support, switch the channel to auto, the platform command, or bell');
      return;
    }

    sendNotification(title, body, onError);
  };
}

/**
 * Names the channel a send would take right now given the channel
 * setting, terminal, bell, or the platform command, or null where the
 * send would land on a platform without a command. The settings dialog
 * shows it on the test row. Detection runs asynchronously after startup,
 * so the auto value can flip to terminal shortly after launch.
 */
export function notificationChannel(renderer: RendererNotificationBoundary, channel: NotifyChannel): string | null {
  if (channel === 'bell' || channel === 'terminal') {
    return channel;
  }

  if (
    channel === 'auto' &&
    renderer.capabilities?.notifications === true &&
    terminalQuirk(renderer) !== 'apple-terminal'
  ) {
    return 'terminal';
  }

  return notificationTool();
}

/**
 * Explains what stands between the terminal path and a visible
 * notification on this terminal, or null where nothing is known to. The
 * settings dialog shows it in place of the test row's hint, because a
 * send through these terminals looks successful to OpenTUI and to the
 * footer while nothing appears. The command and bell channels never
 * touch the notification sequence, so they carry no caveat.
 */
export function notificationCaveat(renderer: RendererNotificationBoundary, channel: NotifyChannel): string | null {
  if (channel === 'command' || channel === 'bell') {
    return null;
  }

  switch (terminalQuirk(renderer)) {
    case 'iterm': {
      return 'iTerm2 shows these only once Notification Center Alerts is on under Settings › Profiles › Terminal';
    }
    case 'apple-terminal': {
      return channel === 'auto'
        ? 'Terminal.app ignores terminal notifications, so auto takes the platform command here'
        : 'Terminal.app ignores terminal notifications · switch the channel to auto, command, or bell';
    }
    default: {
      return null;
    }
  }
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
