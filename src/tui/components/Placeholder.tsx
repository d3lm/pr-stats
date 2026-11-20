import type { LoadPhase } from '../data/load';
import { theme } from '../theme';
import { RateLimitWaitStatus } from './RateLimitWait';
import { Spinner } from './Spinner';

const BAR_WIDTH = 40;

const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

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
 * Paints the bar with cell backgrounds so it stays continuous however the font renders block glyphs.
 */
function LoadProgress({ load }: { load: LoadPhase }) {
  const wait = load.wait ?? null;

  if (!load.total) {
    return (
      <box flexDirection="column" alignItems="center" rowGap={1}>
        <box flexDirection="row" columnGap={1}>
          <text fg={theme.muted}>{loadLabel(load)}</text>
          {wait === null ? <Spinner /> : null}
        </box>
        {wait === null ? null : <RateLimitWaitStatus wait={wait} />}
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
      {wait === null ? null : <RateLimitWaitStatus wait={wait} />}
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
