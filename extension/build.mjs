import * as esbuild from 'esbuild'
import { cpSync, mkdirSync } from 'fs'

// Ensure output dir
mkdirSync('dist', { recursive: true })

// Bundle popup
await esbuild.build({
  entryPoints: ['src/popup.ts'],
  bundle: true,
  outfile: 'dist/popup.js',
  format: 'iife',
  target: 'chrome120',
  minify: false,
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    'global': 'globalThis',
  },
})

// Bundle background service worker
await esbuild.build({
  entryPoints: ['src/background.ts'],
  bundle: true,
  outfile: 'dist/background.js',
  format: 'iife',
  target: 'chrome120',
  minify: false,
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    'global': 'globalThis',
  },
})

// Copy static assets
cpSync('public/manifest.json', 'dist/manifest.json')
cpSync('public/popup.html', 'dist/popup.html')
cpSync('public/popup.css', 'dist/popup.css')

// Copy icons (if they exist)
try {
  mkdirSync('dist/icons', { recursive: true })
  cpSync('icons', 'dist/icons', { recursive: true })
} catch (e) {
  // Icons dir may not exist yet
}

console.log('✅ Extension built to dist/')
