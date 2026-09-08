import { expect, test } from 'bun:test';
import { destroyApp, initial, renderApp, waitForText } from '../testing/harness';
import { Header } from './Header';

test('keeps the rate-limit countdown whole on narrow terminals and cuts the context instead', async () => {
  /**
   * The context of the canned options runs past eighty columns on its
   * own, so at both widths the header has to cut something, and it has
   * to be the context, because the countdown is the only sign that the
   * reload behind the data waits out a limit.
   */
  for (const width of [80, 100]) {
    const setup = await renderApp(
      <Header
        options={{ ...initial, user: 'testuser' }}
        raw={null}
        error={null}
        rateLimited={false}
        spinning={true}
        wait={{ reason: 'retry', until: new Date(Date.now() + 90_000) }}
        reloadEvery={null}
      />,
      { width, height: 2 },
    );

    try {
      await waitForText(setup, 'retrying in 1m');

      const line = setup.captureCharFrame().split('\n')[0];

      expect(line).toMatch(/rate limited by GitHub · retrying in 1m [23]\ds/);
      expect(line).toContain('pr-stats · @testuser');
      expect(line.length).toBeLessThanOrEqual(width);
    } finally {
      destroyApp(setup);
    }
  }
});
