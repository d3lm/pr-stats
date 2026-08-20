import { eslintConfig } from '@d3lm/lint-preset/eslint';
import { oxlintConfig } from '@d3lm/lint-preset/oxlint';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const gitignoreFiles = globSync(['**/.gitignore'], { cwd: import.meta.dirname });

export default defineConfig([
  includeIgnoreFile(
    gitignoreFiles.map((file) => fileURLToPath(new URL(file, import.meta.url))),
    {
      gitignoreResolution: true,
    },
  ),
  ...eslintConfig({
    tsconfigRootDir: import.meta.dirname,
    oxlintConfig,
    ignores: [],
  }),
]);
