import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // NOTE: no manualChunks — manually splitting react/router/vendor cuts through
  // React's circular dependency graph and produces chunks that import each other,
  // causing a "cannot access before initialization" crash (blank page) at runtime.
  // Route-level React.lazy + lazy chart imports already split the bundle safely.
  server: {
    port: 5200,
    host: '0.0.0.0',
  }
})
