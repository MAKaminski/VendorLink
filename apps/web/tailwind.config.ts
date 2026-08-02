import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dense, data-forward surface rather than a marketing palette.
        ink: { DEFAULT: '#0f172a', muted: '#475569', subtle: '#94a3b8' },
        line: '#e2e8f0',
        surface: { DEFAULT: '#ffffff', sunken: '#f8fafc' },
        brand: { DEFAULT: '#0f766e', hover: '#0d5f59', subtle: '#f0fdfa' },
        ok: '#15803d',
        warn: '#b45309',
        bad: '#b91c1c',
      },
    },
  },
  plugins: [],
} satisfies Config;
