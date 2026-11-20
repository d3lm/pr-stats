import { defineConfig } from '@d3lm/lint-preset/comments';

export default defineConfig({
  width: 100,
  maxWidth: 120,
  tolerance: 5,
  singleLineWidth: 100,
  agent: {
    runner: 'claude',
    model: 'haiku',
    scope: 'all',
  },
});
