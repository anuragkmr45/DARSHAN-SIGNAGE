import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, link, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pinAuthorityFile } from '../src/authority-file.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'darshan-authority-file-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'authority.json');
  const value = { version: 1, epoch_id: randomUUID(), authority_secret: randomBytes(32).toString('base64url') };
  await writeFile(filename, JSON.stringify(value), { mode: 0o600 });
  return { directory, filename, value };
}
const invalid = error => error.code === 'AUTHORITY_FILE_INVALID';

test('private authority is validated and its secret is absent from enumerable diagnostic state', async t => {
  const { filename, value } = await fixture(t), authority = pinAuthorityFile(filename);
  assert.equal(authority.epochId, value.epoch_id); authority.assertUnchanged();
  assert.equal(authority.withSecret(secret => secret === value.authority_secret), true);
  assert.equal(JSON.stringify(authority).includes(value.authority_secret), false);
});

test('authority rejects public permissions, symlinks, hardlinks and oversized data', async t => {
  const { directory, filename } = await fixture(t);
  await chmod(filename, 0o644); assert.throws(() => pinAuthorityFile(filename), invalid); await chmod(filename, 0o600);
  const alias = path.join(directory, 'alias'); await symlink(filename, alias); assert.throws(() => pinAuthorityFile(alias), invalid);
  await rm(alias); await link(filename, alias); assert.throws(() => pinAuthorityFile(filename), invalid); await rm(alias);
  await writeFile(filename, 'x'.repeat(4097)); assert.throws(() => pinAuthorityFile(filename), invalid);
});

test('malformed schema, epoch and noncanonical secret encodings fail closed without echoing private data', async t => {
  const { filename, value } = await fixture(t);
  for (const changes of [{ version: 2 }, { epoch_id: 'invalid' }, { extra: true }, { authority_secret: `${value.authority_secret}=` }, { authority_secret: 'short' }]) {
    await writeFile(filename, JSON.stringify({ ...value, ...changes }));
    assert.throws(() => pinAuthorityFile(filename), error => invalid(error) && !String(error).includes(value.authority_secret) && !String(error).includes(filename));
  }
});

test('inode replacement, content change and read failure cannot hot-reset pinned authority', async t => {
  for (const change of ['replace', 'content', 'missing']) {
    const { filename, value } = await fixture(t), authority = pinAuthorityFile(filename);
    if (change === 'replace') { await writeFile(`${filename}.new`, JSON.stringify(value), { mode: 0o600 }); await rename(`${filename}.new`, filename); }
    else if (change === 'content') await writeFile(filename, `${JSON.stringify(value)}\n`);
    else await rm(filename);
    assert.throws(() => authority.assertUnchanged(), error => ['AUTHORITY_FILE_CHANGED', 'AUTHORITY_FILE_INVALID'].includes(error.code));
  }
});
