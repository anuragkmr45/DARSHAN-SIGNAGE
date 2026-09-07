#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const manifestTool = path.join(scriptDir, '../export/artifact-manifest.mjs')

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function readOption(args, name) {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value || value.startsWith('--')) fail(`${name} is required`)
  return path.resolve(value)
}

function readValue(args, name) {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value || value.startsWith('--')) fail(`${name} is required`)
  return value
}

function findManifestDirectories(root) {
  if (!fs.existsSync(root)) fail(`package directory not found: ${root}`)
  const matches = []
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      else if (entry.isFile() && entry.name === 'ARTIFACT_MANIFEST.json') matches.push(current)
    }
  }
  return matches.sort()
}

function verify(directory, release, component, platform) {
  const args = [manifestTool, 'verify', '--output', directory, '--release', release, '--component', component]
  if (platform) args.push('--platform', platform)
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
  if (result.status !== 0) fail(result.stderr.trim() || result.stdout.trim() || `provenance verification failed: ${directory}`)
  try { return JSON.parse(result.stdout) } catch { fail(`invalid provenance verification response: ${directory}`) }
}

const args = process.argv.slice(2)
const release = readValue(args, '--release')
const server = readOption(args, '--server')
const cms = readOption(args, '--cms')
const player = readOption(args, '--player')
const platforms = readValue(args, '--platforms').split(',').map((item) => item.trim()).filter(Boolean)

const serverManifests = findManifestDirectories(server)
const cmsManifests = findManifestDirectories(cms)
if (serverManifests.length !== 1 || serverManifests[0] !== server) fail(`server package must contain exactly one root artifact manifest: ${server}`)
if (cmsManifests.length !== 1 || cmsManifests[0] !== cms) fail(`CMS package must contain exactly one root artifact manifest: ${cms}`)
const verified = [verify(server, release, 'server'), verify(cms, release, 'cms')]

const playerManifests = findManifestDirectories(player)
if (playerManifests.length === 0) fail(`player package has no artifact manifests: ${player}`)
const seenPlatforms = new Set()
for (const directory of playerManifests) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'ARTIFACT_MANIFEST.json'), 'utf8'))
  if (!platforms.includes(manifest.platform)) continue
  if (seenPlatforms.has(manifest.platform)) fail(`player package has more than one ${manifest.platform} artifact manifest`)
  seenPlatforms.add(manifest.platform)
  verified.push(verify(directory, release, 'electron', manifest.platform))
}
for (const platform of platforms) if (!seenPlatforms.has(platform)) fail(`player package is missing ${platform} artifact provenance`)

const commits = new Set(verified.map((item) => item.sourceCommit))
if (commits.size !== 1) fail(`component source commits differ: ${Array.from(commits).join(', ')}`)
process.stdout.write(`${JSON.stringify({ releaseId: release, sourceCommit: verified[0].sourceCommit, platforms: [...seenPlatforms].sort() })}\n`)
