#!/usr/bin/env tsx

import { constants } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { CHROMIUM_RUNTIME_ENV, CHROMIUM_RUNTIME_LAUNCH_ARGS } from '../src/utils/chromium-runtime.js';

const SMOKE_URL = 'https://example.com/';
const DEFAULT_WORKER_UID = 1000;
const DEFAULT_WORKER_GID = 1000;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the Chromium runtime smoke test`);
  }
  return value;
}

async function ensureWritableDirectory(name: string, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await access(directory, constants.W_OK | constants.X_OK);
  const directoryStat = await stat(directory);
  return {
    name,
    directory,
    mode: (directoryStat.mode & 0o7777).toString(8),
    uid: directoryStat.uid,
    gid: directoryStat.gid,
  };
}

function parseExpectedId(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function effectiveId(kind: 'uid' | 'gid') {
  const getter = kind === 'uid' ? process.getuid : process.getgid;
  if (typeof getter !== 'function') {
    throw new Error(`Cannot determine effective ${kind} on this platform`);
  }
  return getter();
}

function assertWorkerIdentity() {
  const uid = effectiveId('uid');
  const gid = effectiveId('gid');
  const expectedWorkerUid = parseExpectedId('DARSHAN_EXPECTED_WORKER_UID', DEFAULT_WORKER_UID);
  const expectedWorkerGid = parseExpectedId('DARSHAN_EXPECTED_WORKER_GID', DEFAULT_WORKER_GID);

  if (uid === 0) {
    throw new Error('Chromium runtime smoke test must run as the unprivileged worker user, not root');
  }
  if (uid !== expectedWorkerUid || gid !== expectedWorkerGid) {
    throw new Error(
      `Chromium runtime smoke test ran as ${uid}:${gid}, expected worker ${expectedWorkerUid}:${expectedWorkerGid}`
    );
  }

  return { uid, gid, expectedWorkerUid, expectedWorkerGid };
}

function assertRuntimeEnv(name: keyof typeof CHROMIUM_RUNTIME_ENV) {
  const actual = requiredEnv(name);
  const expected = CHROMIUM_RUNTIME_ENV[name];
  if (actual !== expected) {
    throw new Error(`${name} must be ${expected} for the Chromium worker runtime, got ${actual}`);
  }
  return actual;
}

function serializeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: typeof error, message: String(error) };
}

async function main() {
  const workerIdentity = assertWorkerIdentity();
  const runtimeDirectories = await Promise.all([
    ensureWritableDirectory('HOME', assertRuntimeEnv('HOME')),
    ensureWritableDirectory('XDG_CONFIG_HOME', assertRuntimeEnv('XDG_CONFIG_HOME')),
    ensureWritableDirectory('XDG_CACHE_HOME', assertRuntimeEnv('XDG_CACHE_HOME')),
    ensureWritableDirectory('TMPDIR', assertRuntimeEnv('TMPDIR')),
  ]);
  const { getResolvedChromiumExecutable } = await import('../src/utils/runtime-dependencies.js');
  const executablePath = await getResolvedChromiumExecutable();
  let browser: Browser | null = await chromium.launch({
    headless: true,
    executablePath,
    args: [...CHROMIUM_RUNTIME_LAUNCH_ARGS],
  });

  try {
    const page = await browser.newPage();
    const response = await page.goto(SMOKE_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (!response?.ok()) {
      throw new Error(`Chromium smoke navigation failed with status ${response?.status() ?? 0}`);
    }
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    if (screenshot.byteLength === 0) {
      throw new Error('Chromium smoke screenshot was empty');
    }
    const title = await page.title();
    const finalUrl = page.url();
    await page.close();
    await browser.close();
    browser = null;
    console.log(JSON.stringify({
      ok: true,
      executablePath,
      launchArgs: [...CHROMIUM_RUNTIME_LAUNCH_ARGS],
      url: finalUrl,
      title,
      screenshotBytes: screenshot.byteLength,
      browserClosed: true,
      ...workerIdentity,
      runtimeDirectories,
    }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: serializeError(error),
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    gid: typeof process.getgid === 'function' ? process.getgid() : null,
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    TMPDIR: process.env.TMPDIR,
  }, null, 2));
  process.exit(1);
});
