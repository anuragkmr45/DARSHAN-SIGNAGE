#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const MANIFEST_NAME = 'ARTIFACT_MANIFEST.json'
const EXCLUDED = new Set([MANIFEST_NAME, 'SHA256SUMS.txt'])

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function value(args, name, required = true) {
  const index = args.indexOf(name)
  const result = index >= 0 ? args[index + 1] : undefined
  if (required && (!result || result.startsWith('--'))) fail(`${name} is required`)
  return result
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function walk(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name)
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) return walk(absolute, relative)
      if (entry.isFile() && !EXCLUDED.has(relative)) return [{ relative, absolute }]
      return []
    })
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

function sourceMetadata(repo) {
  const commit = git(repo, ['rev-parse', 'HEAD'])
  const dirty = git(repo, ['status', '--porcelain']).length > 0
  if (dirty) fail(`Refusing to package a dirty source tree: ${repo}`)
  const lockfile = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']
    .map((name) => path.join(repo, name))
    .find((candidate) => fs.existsSync(candidate))
  return {
    sourceCommit: commit,
    sourceTreeClean: true,
    lockfile: lockfile ? path.basename(lockfile) : null,
    lockfileSha256: lockfile ? sha256(lockfile) : null,
  }
}

function write(args) {
  const outputDir = path.resolve(value(args, '--output'))
  const repo = path.resolve(value(args, '--repo'))
  const releaseId = value(args, '--release')
  const component = value(args, '--component')
  const platform = value(args, '--platform', false) ?? 'any'
  const arch = value(args, '--arch', false) ?? 'any'
  if (!fs.statSync(outputDir).isDirectory()) fail(`output directory not found: ${outputDir}`)
  const manifest = {
    schemaVersion: 1,
    releaseId,
    component,
    platform,
    architecture: arch,
    createdAt: new Date().toISOString(),
    ...sourceMetadata(repo),
    files: walk(outputDir).map(({ relative, absolute }) => ({ path: relative, sha256: sha256(absolute) })),
  }
  fs.writeFileSync(path.join(outputDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
}

function verify(args) {
  const outputDir = path.resolve(value(args, '--output'))
  const releaseId = value(args, '--release')
  const component = value(args, '--component')
  const platform = value(args, '--platform', false)
  const arch = value(args, '--arch', false)
  const manifestPath = path.join(outputDir, MANIFEST_NAME)
  if (!fs.existsSync(manifestPath)) fail(`artifact manifest missing: ${manifestPath}`)
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch { fail(`artifact manifest is invalid JSON: ${manifestPath}`) }
  if (manifest.schemaVersion !== 1) fail(`artifact manifest has unsupported schema: ${manifestPath}`)
  if (manifest.releaseId !== releaseId) fail(`artifact manifest release mismatch in ${outputDir}: expected ${releaseId}, received ${manifest.releaseId}`)
  if (manifest.component !== component) fail(`artifact manifest component mismatch in ${outputDir}: expected ${component}, received ${manifest.component}`)
  if (platform && manifest.platform !== platform) fail(`artifact manifest platform mismatch in ${outputDir}: expected ${platform}, received ${manifest.platform}`)
  if (arch && manifest.architecture !== arch) fail(`artifact manifest architecture mismatch in ${outputDir}: expected ${arch}, received ${manifest.architecture}`)
  if (manifest.sourceTreeClean !== true || !/^[0-9a-f]{40}$/i.test(manifest.sourceCommit ?? '')) fail(`artifact manifest lacks clean source provenance: ${manifestPath}`)
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail(`artifact manifest has no files: ${manifestPath}`)
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]))
  const actual = walk(outputDir)
  if (actual.length !== expected.size) fail(`artifact manifest file set mismatch: ${outputDir}`)
  for (const { relative, absolute } of actual) {
    if (!expected.has(relative)) fail(`artifact manifest missing file ${relative}: ${outputDir}`)
    if (expected.get(relative) !== sha256(absolute)) fail(`artifact manifest checksum mismatch for ${relative}: ${outputDir}`)
  }
  process.stdout.write(`${JSON.stringify({ sourceCommit: manifest.sourceCommit, releaseId: manifest.releaseId })}\n`)
}

const args = process.argv.slice(2)
if (args[0] === 'write') write(args.slice(1))
else if (args[0] === 'verify') verify(args.slice(1))
else fail('Usage: artifact-manifest.mjs write|verify --output <dir> --repo <dir> --release <id> --component <name> [--platform <name>] [--arch <name>]')
