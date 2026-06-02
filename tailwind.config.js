/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg))',
        panel: 'hsl(var(--panel))',
        'panel-2': 'hsl(var(--panel-2))',
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        text: 'hsl(var(--text))',
        muted: 'hsl(var(--muted))',
        dim: 'hsl(var(--dim))',
        brand: 'hsl(var(--brand))',
        gain: 'hsl(var(--gain))',
        loss: 'hsl(var(--loss))',
        warn: 'hsl(var(--warn))',
        accent: 'hsl(var(--accent))',
        'accent-2': 'hsl(var(--accent-2))',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'Inter', 'system-ui', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
