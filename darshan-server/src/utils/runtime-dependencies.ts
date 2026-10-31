import { accessSync, constants, existsSync, readFileSync, readdirSync } from 'fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { delimiter, isAbsolute, join, resolve, sep } from 'path';
import { createLogger } from '@/utils/logger';
import { config as appConfig } from '@/config';

const logger = createLogger('runtime-dependencies');

export type RuntimeDependencyStatus = 'available' | 'missing' | 'optional';
export type RuntimeDependencyRole = 'all' | 'api' | 'worker';

export interface RuntimeDependency {
  name: 'ffmpeg' | 'libreoffice' | 'chromium' | 'pg_dump' | 'tar' | 'age';
  status: RuntimeDependencyStatus;
  path?: string;
  version?: string;
  sha256?: string;
  detail?: string;
}

export interface RuntimeDependencyReport {
  runningInContainer: boolean;
  role: RuntimeDependencyRole;
  dependencies: RuntimeDependency[];
}

function runningInContainer() {
  return process.env.DARSHAN_RUNTIME_CONTAINER === 'true' || process.env.HEXMON_RUNTIME_CONTAINER === 'true' || existsSync('/.dockerenv');
}

function dedupeCandidates(candidates: Array<string | undefined>) {
  return Array.from(new Set(candidates.filter((candidate): candidate is string => Boolean(candidate && candidate.trim()))));
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function findExecutableCandidate(candidate: string) {
  const treatAsPath = isAbsolute(candidate) || candidate.includes(sep) || (sep === '\\' && candidate.includes('/'));
  const resolvedCandidate = treatAsPath ? resolve(candidate) : candidate;
  const searchPath = !treatAsPath;
  const pathEntries = searchPath ? (process.env.PATH || '').split(delimiter).filter(Boolean) : [''];
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter(Boolean)
      : [''];

  const searchTargets =
    !searchPath || pathEntries.length === 0
      ? [resolvedCandidate]
      : pathEntries.flatMap((entry) => extensions.map((extension) => join(entry, `${resolvedCandidate}${extension}`)));

  for (const target of searchTargets) {
    try {
      accessSync(target, constants.X_OK);
      return target;
    } catch {
      // keep searching
    }
  }

  return null;
}

function findPlaywrightChromiumExecutable() {
  const roots = dedupeCandidates([process.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright']);
  const executableNames =
    process.platform === 'win32'
      ? ['chrome.exe', 'msedge.exe']
      : process.platform === 'darwin'
        ? ['Chromium.app/Contents/MacOS/Chromium']
        : ['chrome'];

  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes('chromium'))
        .map((entry) => entry.name)
        .sort();
    } catch {
      continue;
    }

    for (const entry of entries) {
      const installRoot = join(root, entry);
      const candidates = [
        ...executableNames.map((name) => join(installRoot, 'chrome-linux64', name)),
        ...executableNames.map((name) => join(installRoot, 'chrome-linux', name)),
        ...executableNames.map((name) => join(installRoot, name)),
      ];
      const executable = candidates.map(findExecutableCandidate).find(Boolean);
      if (executable) {
        return executable;
      }
    }
  }

  return null;
}

function resolveFfmpegPath() {
  return dedupeCandidates([appConfig.FFMPEG_PATH, 'ffmpeg']).map(findExecutableCandidate).find(Boolean) || null;
}

function resolveLibreOfficePath() {
  const candidates = dedupeCandidates([
    appConfig.LIBREOFFICE_PATH,
    'soffice',
    process.platform === 'win32' ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : undefined,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe' : undefined,
  ]);

  return candidates.map(findExecutableCandidate).find(Boolean) || null;
}

export function getLibreOfficeExecutable() {
  return resolveLibreOfficePath();
}

export function getResolvedFfmpegPath() {
  return resolveFfmpegPath();
}

async function resolveChromiumPath() {
  const configured =
    appConfig.DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH?.trim() ||
    appConfig.HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH?.trim();
  if (configured) {
    const resolvedConfigured = findExecutableCandidate(configured);
    if (!resolvedConfigured) {
      throw new Error(`Configured Chromium executable not found at ${configured}`);
    }

    return resolvedConfigured;
  }

  try {
    const { chromium } = await import('playwright');
    const candidate = chromium.executablePath();
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  } catch (error) {
    const installedExecutable = findPlaywrightChromiumExecutable();
    if (installedExecutable) {
      return installedExecutable;
    }
    throw new Error(`Playwright Chromium is not available: ${normalizeErrorMessage(error)}`);
  }

  const installedExecutable = findPlaywrightChromiumExecutable();
  if (installedExecutable) {
    return installedExecutable;
  }

  throw new Error('Playwright Chromium executable is not installed. Run "npx playwright install chromium" or set DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH.');
}

function resolvePgDumpPath() {
  return dedupeCandidates([appConfig.PG_DUMP_PATH, 'pg_dump']).map(findExecutableCandidate).find(Boolean) || null;
}

function resolveTarPath() {
  return dedupeCandidates([appConfig.TAR_PATH, 'tar']).map(findExecutableCandidate).find(Boolean) || null;
}

function inspectAgeExecutable() {
  const executable = dedupeCandidates([appConfig.AGE_PATH, 'age']).map(findExecutableCandidate).find(Boolean) || null;
  if (!executable) {
    return { path: null, detail: 'Install the pinned age binary or set AGE_PATH to the executable.' };
  }

  const sha256 = createHash('sha256').update(readFileSync(executable)).digest('hex');
  if (appConfig.AGE_SHA256 && sha256.toLowerCase() !== appConfig.AGE_SHA256.toLowerCase()) {
    return { path: executable, sha256, detail: 'age executable digest does not match pinned AGE_SHA256.' };
  }
  const versionResult = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5_000 });
  const version = `${versionResult.stdout || ''}${versionResult.stderr || ''}`.trim().replace(/^v/, '');
  if (versionResult.error || versionResult.status !== 0 || !version) {
    return { path: executable, sha256, detail: `Unable to read age version: ${normalizeErrorMessage(versionResult.error || versionResult.stderr)}` };
  }
  if (appConfig.AGE_VERSION && version !== appConfig.AGE_VERSION.replace(/^v/, '')) {
    return { path: executable, version, sha256, detail: `age version ${version} does not match pinned AGE_VERSION ${appConfig.AGE_VERSION}.` };
  }
  return { path: executable, version, sha256, detail: undefined };
}

export function getResolvedPgDumpPath() {
  return resolvePgDumpPath();
}

export function getResolvedTarPath() {
  return resolveTarPath();
}

export async function getResolvedChromiumExecutable() {
  return resolveChromiumPath();
}

function hasConfiguredChromiumPath() {
  return Boolean(
    appConfig.DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH?.trim() ||
      appConfig.HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH?.trim()
  );
}

function getRequiredDependencyNames(role: RuntimeDependencyRole) {
  if (role === 'api') {
    return new Set<RuntimeDependency['name']>();
  }

  const required = new Set<RuntimeDependency['name']>(['ffmpeg', 'libreoffice', 'pg_dump', 'tar']);
  if (appConfig.NODE_ENV === 'production' && appConfig.BACKUP_REPOSITORY_KIND === 'LOCAL_FILESYSTEM') {
    required.add('age');
  }
  return required;
}

export async function inspectRuntimeDependencies(role: RuntimeDependencyRole = 'all'): Promise<RuntimeDependencyReport> {
  const ffmpegPath = resolveFfmpegPath();
  const libreOfficePath = resolveLibreOfficePath();
  const pgDumpPath = resolvePgDumpPath();
  const tarPath = resolveTarPath();
  const age = inspectAgeExecutable();
  const requiredNames = getRequiredDependencyNames(role);
  const chromiumRequired = appConfig.NODE_ENV === 'production' || hasConfiguredChromiumPath();
  let chromiumPath: string | null = null;
  let chromiumDetail: string | undefined;

  try {
    chromiumPath = await resolveChromiumPath();
  } catch (error) {
    chromiumDetail = normalizeErrorMessage(error);
  }

  return {
    runningInContainer: runningInContainer(),
    role,
    dependencies: [
      {
        name: 'ffmpeg',
        status: ffmpegPath ? 'available' : requiredNames.has('ffmpeg') ? 'missing' : 'optional',
        path: ffmpegPath || undefined,
        detail: ffmpegPath ? undefined : 'Install ffmpeg or set FFMPEG_PATH to the executable.',
      },
      {
        name: 'libreoffice',
        status: libreOfficePath ? 'available' : requiredNames.has('libreoffice') ? 'missing' : 'optional',
        path: libreOfficePath || undefined,
        detail: libreOfficePath ? undefined : 'Install LibreOffice/soffice or set LIBREOFFICE_PATH to the executable.',
      },
      {
        name: 'chromium',
        status: chromiumPath ? 'available' : chromiumRequired ? 'missing' : 'optional',
        path: chromiumPath || undefined,
        detail:
          chromiumPath
            ? undefined
            : chromiumDetail ||
              'Install Playwright Chromium with "npx playwright install chromium" or set DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH.',
      },
      {
        name: 'pg_dump',
        status: pgDumpPath ? 'available' : requiredNames.has('pg_dump') ? 'missing' : 'optional',
        path: pgDumpPath || undefined,
        detail: pgDumpPath ? undefined : 'Install pg_dump or set PG_DUMP_PATH to the executable.',
      },
      {
        name: 'tar',
        status: tarPath ? 'available' : requiredNames.has('tar') ? 'missing' : 'optional',
        path: tarPath || undefined,
        detail: tarPath ? undefined : 'Install tar or set TAR_PATH to the executable.',
      },
      {
        name: 'age',
        status: age.path && !age.detail ? 'available' : requiredNames.has('age') ? 'missing' : 'optional',
        path: age.path || undefined,
        version: age.version,
        sha256: age.sha256,
        detail: age.detail,
      },
    ],
  };
}

export async function validateRuntimeDependencies(role: RuntimeDependencyRole = 'all') {
  const report = await inspectRuntimeDependencies(role);
  const missingCritical = report.dependencies.filter((dependency) => dependency.status === 'missing');

  if (
    appConfig.NODE_ENV === 'production' &&
    role !== 'api' &&
    report.dependencies.some((dependency) => dependency.name === 'chromium' && dependency.status === 'available') &&
    typeof process.getuid === 'function' &&
    process.getuid() === 0
  ) {
    throw new Error('Production webpage capture worker must run as a non-root user so Chromium sandboxing remains enabled.');
  }

  if (missingCritical.length > 0) {
    throw new Error(
      `Missing required runtime dependencies: ${missingCritical
        .map((dependency) => dependency.name)
        .join(', ')}. Install the missing tools on the host or configure FFMPEG_PATH, LIBREOFFICE_PATH, PG_DUMP_PATH, TAR_PATH, AGE_PATH/AGE_VERSION/AGE_SHA256, and DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH as needed.`
    );
  } else {
    logger.info(
      {
        runningInContainer: report.runningInContainer,
        dependencies: report.dependencies,
      },
      'Runtime dependencies validated successfully'
    );
  }

  return report;
}
