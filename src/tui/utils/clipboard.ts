import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  type ClipboardService,
  type ClipboardWriteResult,
  type RendererClipboardBoundary,
} from '@opentui/core';

/**
 * Describes why a write reached neither destination, preferring
 * the host backend's own error message when it produced one.
 */
function failureReason(result: ClipboardWriteResult): string {
  if (result.host.status === 'failed') {
    return result.host.error.message;
  }

  return `host ${result.host.status}, terminal ${result.terminal.status}`;
}

/**
 * Builds the copy function on OpenTUI's clipboard service, which talks
 * to the Wayland, X11, Win32, or macOS clipboard natively and falls
 * back to an OSC 52 escape through the terminal. Nothing shells out, so
 * the copy works without xclip or wl-copy installed and reaches the
 * local machine over SSH. The service comes to life on the first copy
 * and stays alive for the rest of the session, because on Linux the
 * process itself serves later pastes. A copy that reaches neither the
 * host nor the terminal reports through onError instead of tearing
 * down the TUI, so the caller can tell the user the copy failed rather
 * than staying silent.
 */
export function createClipboardCopier(
  renderer: RendererClipboardBoundary,
): (text: string, onError: (message: string) => void) => void {
  let service: ClipboardService | null = null;

  return (text, onError) => {
    service ??= createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(renderer),
    });

    service
      .writeText(text, { destination: 'best-available' })
      .then((result) => {
        if (result.host.status !== 'written' && result.terminal.status !== 'attempted') {
          onError(`could not copy the link (${failureReason(result)})`);
        }
      })
      .catch((error: unknown) => {
        onError(`could not copy the link (${error instanceof Error ? error.message : String(error)})`);
      });
  };
}
