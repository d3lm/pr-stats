import { createOxlintConfig } from '@d3lm/lint-preset/oxlint';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [createOxlintConfig()],
});
