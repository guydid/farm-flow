import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── חותמת גרסה ─────────────────────────────────────────────────────────────
// version מ-package.json, build = git short hash (+ "-dirty" אם יש שינויים לא מחויבים), זמן build.
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))
function gitBuild() {
  try {
    const hash = execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
    return dirty ? `${hash}-dirty` : hash
  } catch {
    return 'local'
  }
}
const BUILD_INFO = { version: pkg.version, build: gitBuild(), builtAt: new Date().toISOString() }

// כותב dist/version.json (לבדיקת "גרסה חדשה זמינה" בזמן ריצה) ומטביע את ה-build ב-sw.js
// כדי שה-Service Worker יתעדכן וינקה קאש ישן בכל פריסה.
function versionFilesPlugin() {
  return {
    name: 'farm-flow-version-files',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist')
      if (!fs.existsSync(outDir)) return
      fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(BUILD_INFO))
      const swPath = path.join(outDir, 'sw.js')
      if (fs.existsSync(swPath)) {
        const sw = fs.readFileSync(swPath, 'utf8').replace(/farm-flow-v1/g, `farm-flow-${BUILD_INFO.build}`)
        fs.writeFileSync(swPath, sw)
      }
      console.log(`  build stamp: v${BUILD_INFO.version} ${BUILD_INFO.build} ${BUILD_INFO.builtAt}`)
    },
  }
}

export default defineConfig({
  plugins: [react(), versionFilesPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_INFO.version),
    __APP_BUILD__: JSON.stringify(BUILD_INFO.build),
    __APP_BUILT_AT__: JSON.stringify(BUILD_INFO.builtAt),
  },
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
