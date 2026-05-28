/**
 * Copy static assets to dist folder
 */

const fs = require('fs')
const path = require('path')

// Ensure dist/renderer directory exists
const distRendererDir = path.join(__dirname, '../dist/renderer')
if (!fs.existsSync(distRendererDir)) {
  fs.mkdirSync(distRendererDir, { recursive: true })
}

// Copy index.html
const srcHtml = path.join(__dirname, '../src/renderer/index.html')
const destHtml = path.join(distRendererDir, 'index.html')

console.log('Copying assets...')
console.log(`  ${srcHtml} -> ${destHtml}`)

fs.copyFileSync(srcHtml, destHtml)

// Copy config.json for runtime config resolution
const distMainDir = path.join(__dirname, '../dist/main')
if (!fs.existsSync(distMainDir)) {
  fs.mkdirSync(distMainDir, { recursive: true })
}

const srcConfig = path.join(__dirname, '../config.json')
const destConfig = path.join(distMainDir, 'config.json')

if (fs.existsSync(srcConfig)) {
  console.log(`  ${srcConfig} -> ${destConfig}`)
  fs.copyFileSync(srcConfig, destConfig)
}

console.log('✓ Assets copied successfully')
