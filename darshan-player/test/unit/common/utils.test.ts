/**
 * Unit tests for common utilities
 */

const { expect } = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const path = require('path')
const { createTempDir, cleanupTempDir, createTestFile, calculateHash } = require('../../helpers/test-utils.ts')

// Import functions to test
const {
  calculateFileHash,
  atomicWrite,
  ensureDir,
  retryWithBackoff,
  sanitizeFilename,
  parseTime,
} = require('../../../src/common/utils.ts')

describe('Common Utils', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('utils-test-')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
    sinon.restore()
  })

  describe('calculateFileHash', () => {
    it('should calculate SHA-256 hash of file', async () => {
      const filePath = path.join(tempDir, 'test.txt')
      const content = Buffer.from('test content')
      fs.writeFileSync(filePath, content)

      const expectedHash = calculateHash(content)
      const actualHash = await calculateFileHash(filePath)

      expect(actualHash).to.equal(expectedHash)
    })

    it('should throw error for non-existent file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.txt')

      try {
        await calculateFileHash(filePath)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
      }
    })
  })

  describe('atomicWrite', () => {
    it('should write file atomically', async () => {
      const filePath = path.join(tempDir, 'atomic.txt')
      const content = Buffer.from('atomic content')

      await atomicWrite(filePath, content)

      expect(fs.existsSync(filePath)).to.be.true
      const readContent = fs.readFileSync(filePath)
      expect(readContent.toString()).to.equal(content.toString())
    })

    it('should overwrite existing file', async () => {
      const filePath = path.join(tempDir, 'overwrite.txt')
      fs.writeFileSync(filePath, 'old content')

      const newContent = Buffer.from('new content')
      await atomicWrite(filePath, newContent)

      const readContent = fs.readFileSync(filePath)
      expect(readContent.toString()).to.equal(newContent.toString())
    })

    it('should create parent directories if needed', async () => {
      const filePath = path.join(tempDir, 'subdir', 'nested', 'file.txt')
      const content = Buffer.from('nested content')

      await atomicWrite(filePath, content)

      expect(fs.existsSync(filePath)).to.be.true
    })
  })

  describe('ensureDir', () => {
    it('should create directory if it does not exist', () => {
      const dirPath = path.join(tempDir, 'newdir')

      ensureDir(dirPath, 0o755)

      expect(fs.existsSync(dirPath)).to.be.true
      expect(fs.statSync(dirPath).isDirectory()).to.be.true
    })

    it('should not throw if directory already exists', () => {
      const dirPath = path.join(tempDir, 'existingdir')
      fs.mkdirSync(dirPath)

      expect(() => ensureDir(dirPath, 0o755)).to.not.throw()
    })

    it('should create nested directories', () => {
      const dirPath = path.join(tempDir, 'nested', 'deep', 'dir')

      ensureDir(dirPath, 0o755)

      expect(fs.existsSync(dirPath)).to.be.true
    })
  })

  describe('retryWithBackoff', () => {
    it('should succeed on first try', async () => {
      const fn = sinon.stub().resolves('success')

      const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 100 })

      expect(result).to.equal('success')
      expect(fn.callCount).to.equal(1)
    })

    it('should retry on failure and eventually succeed', async () => {
      const fn = sinon.stub()
      fn.onCall(0).rejects(new Error('fail 1'))
      fn.onCall(1).rejects(new Error('fail 2'))
      fn.onCall(2).resolves('success')

      const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 10 })

      expect(result).to.equal('success')
      expect(fn.callCount).to.equal(3)
    })

    it('should throw after max retries', async () => {
      const fn = sinon.stub().rejects(new Error('always fails'))

      try {
        await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 10 })
        expect.fail('Should have thrown error')
      } catch (error: any) {
        expect(error.message).to.equal('always fails')
        expect(fn.callCount).to.equal(3)
      }
    })

    it('should apply exponential backoff', async () => {
      const fn = sinon.stub()
      fn.onCall(0).rejects(new Error('fail 1'))
      fn.onCall(1).rejects(new Error('fail 2'))
      fn.onCall(2).resolves('success')

      const startTime = Date.now()
      await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 50 })
      const elapsed = Date.now() - startTime

      // Should have waited at least 50ms + 100ms = 150ms
      expect(elapsed).to.be.at.least(100)
    })
  })

  describe('sanitizeFilename', () => {
    it('should remove directory traversal attempts', () => {
      const malicious = '../../../etc/passwd'
      const sanitized = sanitizeFilename(malicious)

      expect(sanitized).to.not.include('..')
    })

    it('should remove null bytes', () => {
      const malicious = 'file\x00.txt'
      const sanitized = sanitizeFilename(malicious)

      expect(sanitized).to.not.include('\x00')
    })

    it('should allow normal paths', () => {
      const normal = 'path/to/file.txt'
      const sanitized = sanitizeFilename(normal)

      expect(sanitized).to.not.include('/')
    })

    it('should handle empty string', () => {
      const sanitized = sanitizeFilename('')

      expect(sanitized).to.equal('')
    })
  })

  describe('parseTime', () => {
    it('should parse valid time strings', () => {
      expect(parseTime('00:05')).to.deep.equal({ hours: 0, minutes: 5 })
      expect(parseTime('12:30')).to.deep.equal({ hours: 12, minutes: 30 })
      expect(parseTime('23:59')).to.deep.equal({ hours: 23, minutes: 59 })
    })

    it('should handle invalid format', () => {
      expect(parseTime('invalid')).to.be.null
      expect(parseTime('5:00')).to.be.null
    })

    it('should handle out-of-range values', () => {
      expect(parseTime('24:00')).to.be.null
      expect(parseTime('00:60')).to.be.null
    })

    it('should handle negative values', () => {
      expect(parseTime('-5:00')).to.be.null
    })
  })
})
