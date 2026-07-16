import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
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
