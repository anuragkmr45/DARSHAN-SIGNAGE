/**
 * Remove generated source maps and TypeScript declaration files from
 * production player build output.
 *
 * The player is a kiosk/runtime application. Shipping source maps in the
 * packaged artifact makes renderer/main source easier to inspect without
 * improving runtime behavior.
 */

const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '../dist')

function stripSourceMappingUrlComment(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const next = content.replace(/\n?\/\/# sourceMappingURL=.*$/gm, '').replace(/\n?\/\*# sourceMappingURL=[\s\S]*?\*\//gm, '')
  if (next !== content) {
    fs.writeFileSync(filePath, next)
    return 1
  }
  return 0
}

function removeInspectionArtifacts(dir) {
  if (!fs.existsSync(dir)) {
    return 0
  }

  let changed = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      changed += removeInspectionArtifacts(entryPath)
      continue
    }
    if (entry.isFile() && (entry.name.endsWith('.map') || entry.name.endsWith('.d.ts'))) {
      fs.unlinkSync(entryPath)
      changed += 1
      continue
    }
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.html'))) {
      changed += stripSourceMappingUrlComment(entryPath)
    }
  }
  return changed
}

const changed = removeInspectionArtifacts(distDir)
console.log(`Removed ${changed} player source map/declaration artifact(s) from dist`)
