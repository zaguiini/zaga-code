import { tanstackConfig } from '@tanstack/eslint-config'
import prettier from 'eslint-plugin-prettier'
import prettierConfig from 'eslint-config-prettier'

export default [
  {
    ignores: ['eslint.config.js', 'prettier.config.js', '*.config.js'],
  },
  ...tanstackConfig,
  {
    plugins: {
      prettier,
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
    },
  },
]
