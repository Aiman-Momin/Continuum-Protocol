import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      global: 'globalThis',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // Use the Node/ESM build; the "browser" UMD bundle breaks named exports in Vite.
        '@stellar/stellar-sdk': path.resolve(
          __dirname,
          'node_modules/@stellar/stellar-sdk/lib/no-axios/index.js',
        ),
      },
    },
    optimizeDeps: {
      include: ['@stellar/stellar-sdk', '@stellar/stellar-base'],
    },
    server: {
      
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
