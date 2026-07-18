import type { Config } from 'tailwindcss';

/** Tailwind maps straight onto the shared brand tokens (CSS variables). */
export default {
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-secondary': 'var(--bg-secondary)',
        surface: 'var(--surface)',
        border: 'var(--border)',
        fg: 'var(--text)',
        muted: 'var(--text-muted)',
        accent: 'var(--accent)',
        healthy: 'var(--healthy)',
        warning: 'var(--warning)',
        critical: 'var(--critical)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
