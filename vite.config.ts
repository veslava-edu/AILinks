import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
          onwarn(warning, warn) {
            // Suprimir advertencias específicas si es necesario
            if (warning.code === 'UNUSED_EXTERNAL_IMPORT') return;
            warn(warning);
          }
        }
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Permitir servir archivos desde la raíz del proyecto (incluyendo carpeta bd)
        fs: {
          allow: ['.']
        },
        // Proxy opcional para desarrollo (el frontend puede llamar directamente al backend)
        // proxy: {
        //   '/api': {
        //     target: 'http://localhost:3001',
        //     changeOrigin: true
        //   }
        // }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
        'process.env.SCRAPER_API_URL': JSON.stringify(env.SCRAPER_API_URL || 'http://localhost:3001')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
