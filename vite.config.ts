import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> dist/ (일반 정적 사이트)
// `npm run build:single` -> dist-single/index.html (파일 하나로 모두 묶은 버전)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
}));
