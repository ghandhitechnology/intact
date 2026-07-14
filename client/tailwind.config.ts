import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        portal: {
          green: '#087a55',
          blue: '#1769c2',
          ink: '#15201c',
          line: '#dce4e0',
          muted: '#f4f7f6',
        },
      },
      boxShadow: {
        'portal': '0 10px 28px rgba(28, 50, 42, 0.09)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};
export default config;
