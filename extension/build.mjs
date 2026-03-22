import * as esbuild from 'esbuild'
import { cpSync, mkdirSync } from 'fs'

mkdirSync('dist', { recursive: true })

const shared = {
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: false,
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    'global': 'globalThis',
  },
}

// Popup
await esbuild.build({
  ...shared,
  entryPoints: ['src/popup.ts'],
  outfile: 'dist/popup.js',
})

// Background service worker (MPP + expiry)
await esbuild.build({
  ...shared,
  entryPoints: ['src/background.ts'],
  outfile: 'dist/background.js',
})

// MPP content script (isolated world — bridges page ↔ background)
await esbuild.build({
  ...shared,
  entryPoints: ['src/mpp-content.ts'],
  outfile: 'dist/mpp-content.js',
})

// MPP inject script (main world — wraps fetch)
await esbuild.build({
  ...shared,
  entryPoints: ['src/mpp-inject.ts'],
  outfile: 'dist/mpp-inject.js',
})

// Copy static assets
cpSync('public/manifest.json', 'dist/manifest.json')
cpSync('public/popup.html', 'dist/popup.html')
cpSync('public/popup.css', 'dist/popup.css')

// Copy icons
try {
  mkdirSync('dist/icons', { recursive: true })
  cpSync('icons', 'dist/icons', { recursive: true })
} catch (e) {}

console.log('✅ Extension built to dist/')
