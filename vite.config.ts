import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: 'public-app',
  resolve: {
    alias: {
      '@': resolve(rootDir, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll('\\', '/');
          if (moduleId.includes('/@firebase/firestore/') || moduleId.includes('/firebase/firestore/')) return 'firebase-firestore';
          if (moduleId.includes('/@firebase/auth/') || moduleId.includes('/firebase/auth/')) return 'firebase-auth';
          if (moduleId.includes('/@firebase/functions/') || moduleId.includes('/firebase/functions/')) return 'firebase-functions';
          if (moduleId.includes('/@firebase/storage/') || moduleId.includes('/firebase/storage/')) return 'firebase-storage';
          if (moduleId.includes('/@firebase/app-check/') || moduleId.includes('/firebase/app-check/')) return 'firebase-app-check';
          if (moduleId.includes('/@firebase/') || moduleId.includes('/firebase/')) return 'firebase-core';
          return undefined;
        },
      },
    },
  },
});
