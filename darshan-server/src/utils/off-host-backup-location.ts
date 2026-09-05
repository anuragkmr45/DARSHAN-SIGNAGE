/**
 * Parse the credential-free S3 URI that identifies the independent backup
 * repository. This intentionally accepts only an S3 URI: an arbitrary HTTPS
 * URL does not define a safe upload, retention, verification, or restore
 * protocol.
 */
export type OffHostBackupLocation = {
  bucket: string;
  prefix: string;
  uri: string;
};

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new Error('Off-host backup destination contains an invalid percent-encoded path segment.');
  }
}

export function parseOffHostBackupLocation(value: string): OffHostBackupLocation {
  // URL normalizes dot segments before exposing pathname. Reject the original
  // representation so a reviewed destination can never silently mean a
  // different prefix after URL parsing.
  if (/(?:^|\/)\.\.(?:\/|$)|(?:^|\/)\.(?:\/|$)/.test(value)) {
    throw new Error('Off-host backup destination prefix must not contain dot path segments.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Off-host backup destination must be an s3://bucket/prefix URI.');
  }

  if (
    url.protocol !== 's3:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname ||
    url.pathname === '/'
  ) {
    throw new Error('Off-host backup destination must be an s3://bucket/prefix URI without credentials, query, or fragment.');
  }

  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map(decodeSegment);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('Off-host backup destination must contain a non-empty safe object prefix.');
  }

  const bucket = decodeSegment(url.hostname);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('Off-host backup destination bucket name is invalid.');
  }

  const prefix = segments.join('/');
  return {
    bucket,
    prefix,
    uri: `s3://${bucket}/${segments.map(encodeURIComponent).join('/')}`,
  };
}

export function offHostBackupObjectKey(location: OffHostBackupLocation, relativeKey: string): string {
  const normalized = relativeKey.replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((segment) => segment === '.' || segment === '..' || !segment)) {
    throw new Error('Off-host backup object key must be a safe non-empty relative path.');
  }
  return `${location.prefix}/${normalized}`;
}
