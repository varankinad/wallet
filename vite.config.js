import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages project URL: https://USERNAME.github.io/wallet/
  base: process.env.VITE_BASE_PATH || '/wallet/'
});
