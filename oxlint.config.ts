import { createOxlintConfig } from '@d3lm/lint-preset/oxlint';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [
    createOxlintConfig({
      react: true,
    }),
  ],
  rules: {
    'no-process-exit': 'off',
    'react-perf/jsx-no-new-function-as-prop': 'off',
    'react-perf/jsx-no-jsx-as-prop': 'off',
    'react-perf/jsx-no-new-object-as-prop': 'off',
    'react-perf/jsx-no-new-array-as-prop': 'off',
    'react/no-object-type-as-default-prop': 'off',
    'react/no-unknown-property': 'off',
  },
  overrides: [
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      rules: {
        'no-process-exit': 'off',
      },
    },
  ],
});
