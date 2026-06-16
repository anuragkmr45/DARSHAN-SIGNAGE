export function redactUrlForDiagnostics(url: string | undefined | null): string | undefined {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return undefined
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return '[invalid-url-redacted]'
  }

  if (!parsed.hostname) {
    return '[invalid-url-redacted]'
  }

  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''

  return parsed.toString().replace(/\/$/, '')
}

export function redactUrlOrPathForDiagnostics(url: string | undefined | null): string | undefined {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return undefined
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return redactUrlForDiagnostics(url)
  }

  if (url.startsWith('/')) {
    try {
      const parsed = new URL(url, 'https://diagnostics.local')
      return parsed.pathname || '/'
    } catch {
      return '[invalid-url-redacted]'
    }
  }

  return '[invalid-url-redacted]'
}

const ABSOLUTE_URL_SUBSTRING_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi
const TRAILING_URL_PUNCTUATION_PATTERN = /[),.;!?]+$/
const SECRET_ASSIGNMENT_PATTERN =
  /\b(token|access_token|refresh_token|key|api_key|access_key|secret|password|pass|signature|sig|credential|auth|jwt|session)=([^&\s"'<>]+)/gi

function splitTrailingPunctuation(value: string): { candidate: string; trailing: string } {
  const match = value.match(TRAILING_URL_PUNCTUATION_PATTERN)
  if (!match || !match[0]) {
    return { candidate: value, trailing: '' }
  }

  return {
    candidate: value.slice(0, -match[0].length),
    trailing: match[0],
  }
}

export function redactUrlSubstringsForDiagnostics(value: string): string {
  return value.replace(ABSOLUTE_URL_SUBSTRING_PATTERN, (match) => {
    const { candidate, trailing } = splitTrailingPunctuation(match)
    const redacted = redactUrlForDiagnostics(candidate) || '[invalid-url-redacted]'
    return `${redacted}${trailing}`
  }).replace(SECRET_ASSIGNMENT_PATTERN, '[redacted]')
}

function isUrlLikeKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase()
  return (
    normalized === 'url' ||
    normalized === 'uri' ||
    normalized === 'href' ||
    normalized === 'sourceid' ||
    normalized === 'expected' ||
    normalized === 'actual' ||
    normalized === 'apibase' ||
    normalized === 'baseurl' ||
    normalized === 'wsurl' ||
    normalized === 'socketurl' ||
    normalized === 'socketiourl' ||
    normalized === 'uploadurl' ||
    normalized === 'logurl' ||
    normalized === 'liveurl' ||
    normalized.endsWith('url') ||
    normalized.endsWith('uri')
  )
}

function redactValueForUrlLikeKey(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactUrlOrPathForDiagnostics(value)
  }

  if (value instanceof URL) {
    return redactUrlForDiagnostics(value.toString())
  }

  return sanitizeLogPayloadForDiagnostics(value)
}

export function sanitizeLogPayloadForDiagnostics(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth: number = 0
): unknown {
  if (depth > 8) {
    return '[MaxDepth]'
  }

  if (typeof value === 'string') {
    return redactUrlSubstringsForDiagnostics(value)
  }

  if (value instanceof URL) {
    return redactUrlForDiagnostics(value.toString())
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `[Buffer length=${value.length}]`
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactUrlSubstringsForDiagnostics(value.message),
      stack: value.stack ? redactUrlSubstringsForDiagnostics(value.stack) : undefined,
    }
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)
    return value.map((item) => sanitizeLogPayloadForDiagnostics(item, seen, depth + 1))
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)

    const sanitized: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      sanitized[key] = isUrlLikeKey(key)
        ? redactValueForUrlLikeKey(entry)
        : sanitizeLogPayloadForDiagnostics(entry, seen, depth + 1)
    }
    return sanitized
  }

  return value
}
