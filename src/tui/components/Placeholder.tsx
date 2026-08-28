import type { LoadPhase } from '../data/load';
import { theme } from '../theme';
import { Spinner } from './Spinner';

const BAR_WIDTH = 40;

/**
 * Eighth-width block characters that fill the bar's last cell in sub-cell
 * steps.
 */
const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

/**
 * Fills a tab's content area while there is no data to render, with the
 * load progress during a load, the error after a failed one, and an idle
 * hint otherwise.
 */
export function Placeholder({
  error,
  loading,
  load,
}: {
  error: string | null;
  loading: boolean;
  load: LoadPhase | null;
}) {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
      {error !== null ? (
        <text fg={theme.error}>{error}</text>
      ) : loading && load !== null ? (
        <LoadProgress load={load} />
      ) : (
        <text fg={theme.muted}>no data yet, press r to load</text>
      )}
    </box>
  );
}

/**
 * Renders the load phase as a label with a progress bar underneath. Phases
 * without a measurable total, like the PR search, show the label with a
 * spinner on its right instead. The done count is padded to the total's
 * width so the centered line keeps a stable width while the numbers tick
 * up.
 *
 * The bar is painted with cell backgrounds instead of block glyphs, so it
 * stays continuous no matter how the font renders block characters. Only
 * the boundary cell draws a glyph, an eighth-width block in the fill color
 * on the track background, so sub-cell progress still shows without ever
 * exposing the terminal background as a gap.
 */
function LoadProgress({ load }: { load: LoadPhase }) {
  if (!load.total) {
    return (
      <box flexDirection="row" columnGap={1}>
        <text fg={theme.muted}>{loadLabel(load)}</text>
        <Spinner />
      </box>
    );
  }

  const done = load.done ?? 0;
  const cells = Math.min(done / load.total, 1) * BAR_WIDTH;
  const whole = Math.floor(cells);
  const partial = whole < BAR_WIDTH ? PARTIAL_BLOCKS[Math.floor((cells - whole) * 8)] : '';
  const counter = `${String(done).padStart(String(load.total).length)}/${load.total}`;

  return (
    <box flexDirection="column" alignItems="center" rowGap={1}>
      <text fg={theme.muted}>{loadLabel(load)}</text>
      <text wrapMode="none">
        <span bg={theme.accent}>{' '.repeat(whole)}</span>
        <span fg={theme.accent} bg={theme.selectedBg}>
          {partial}
        </span>
        <span bg={theme.selectedBg}>{' '.repeat(BAR_WIDTH - whole - partial.length)}</span>
        <span fg={theme.muted}>{`  ${counter}`}</span>
      </text>
    </box>
  );
}

function loadLabel(load: LoadPhase): string {
  return load.phase === 'search' ? 'searching PRs' : 'fetching PR details';
}
