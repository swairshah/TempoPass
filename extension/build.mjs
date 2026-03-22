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

await esbuild.build({
  ...shared,
  entryPoints: ['src/popup.ts'],
  outfile: 'dist/popup.js',
})

await esbuild.build({
  ...shared,
  entryPoints: ['src/background.ts'],
  outfile: 'dist/background.js',
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
