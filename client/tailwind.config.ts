import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // Sharper corners across the app (Tailwind defaults scaled down ~1 step).
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.25rem',
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.625rem',
        '3xl': '0.75rem',
      },
      colors: {
        portal: {
          green: '#1d5b46',
          blue: '#365f7a',
          ink: '#202722',
          line: '#dfe3df',
          muted: '#f5f4ef',
        },
      },
    },
  },
  plugins: [],
};
export default config;
