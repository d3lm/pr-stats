import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  type ClipboardService,
  type ClipboardWriteResult,
  type RendererClipboardBoundary,
} from '@opentui/core';

function failureReason(result: ClipboardWriteResult): string {
  if (result.host.status === 'failed') {
    return result.host.error.message;
  }

  return `host ${result.host.status}, terminal ${result.terminal.status}`;
}

/**
 * The service outlives each copy because on Linux the process itself serves later pastes.
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
