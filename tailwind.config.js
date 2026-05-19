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
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
