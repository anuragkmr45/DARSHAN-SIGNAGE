#!/usr/bin/env tsx

import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { getResolvedChromiumExecutable } from '../src/utils/runtime-dependencies.js';

const SMOKE_URL = 'https://example.com/';

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
  return { name, directory };
}

function serializeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: typeof error, message: String(error) };
}

async function main() {
  const runtimeDirectories = await Promise.all([
    ensureWritableDirectory('HOME', requiredEnv('HOME')),
    ensureWritableDirectory('XDG_CONFIG_HOME', requiredEnv('XDG_CONFIG_HOME')),
    ensureWritableDirectory('XDG_CACHE_HOME', requiredEnv('XDG_CACHE_HOME')),
    ensureWritableDirectory('TMPDIR', requiredEnv('TMPDIR')),
  ]);
  const executablePath = await getResolvedChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    const response = await page.goto(SMOKE_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (!response?.ok()) {
      throw new Error(`Chromium smoke navigation failed with status ${response?.status() ?? 0}`);
    }
    const title = await page.title();
    console.log(JSON.stringify({
      ok: true,
      executablePath,
      url: page.url(),
      title,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      runtimeDirectories,
    }, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: serializeError(error),
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    TMPDIR: process.env.TMPDIR,
  }, null, 2));
  process.exit(1);
});
