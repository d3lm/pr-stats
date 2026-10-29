import { expect, test } from 'bun:test';
import { useLayoutEffect, useState } from 'react';
import { destroyApp, renderApp } from '../testing/harness';
import { useDeferredLoading } from './useDeferredLoading';

const MIN_DURATION = 400;

/**
 * Starts loading on mount and finishes in a layout effect of the same
 * commit, so React re-renders synchronously, before any timer the hook
 * set up could fire. That is the shape of a load that resolves at once,
 * like the startup snapshot the App shows with a zero delay.
 */
function InstantLoad({ showDelay }: { showDelay: number }) {
  const [loading, setLoading] = useState(true);
  const visible = useDeferredLoading(loading, { showDelay, minDuration: MIN_DURATION });

  useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the cascading synchronous render is the timing under test
    setLoading(false);
  }, []);

  return <text>{visible ? 'shown' : 'hidden'}</text>;
}

async function frameAfter(ms: number, setup: Awaited<ReturnType<typeof renderApp>>): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await setup.renderOnce();

  return setup.captureCharFrame();
}

test('an indicator shown from the first render lingers for the minimum even when the load ends at once', async () => {
  const setup = await renderApp(<InstantLoad showDelay={0} />, { width: 20, height: 1 });

  try {
    // well inside the minimum, the indicator that showed on the first frame is still up
    expect(await frameAfter(MIN_DURATION / 4, setup)).toContain('shown');

    // past the minimum, it goes
    expect(await frameAfter(MIN_DURATION, setup)).toContain('hidden');
  } finally {
    destroyApp(setup);
  }
});

test('a load that ends before a positive delay never shows the indicator', async () => {
  const setup = await renderApp(<InstantLoad showDelay={50} />, { width: 20, height: 1 });

  try {
    expect(await frameAfter(MIN_DURATION / 4, setup)).toContain('hidden');
  } finally {
    destroyApp(setup);
  }
});
