import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@/utils/app-error';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const RESERVED_PREFIXES = ['/api/', '/socket.io/', '/metrics'];

function isReservedPath(pathname: string) {
  return RESERVED_PREFIXES.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
}

function setCacheHeaders(reply: FastifyReply, pathname: string) {
  if (pathname === '/config/app-config.json') {
    reply.header('Cache-Control', 'no-store');
  } else if (pathname === '/' || pathname.endsWith('.html')) {
    reply.header('Cache-Control', 'no-cache');
  } else if (pathname.startsWith('/assets/')) {
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    reply.header('Cache-Control', 'public, max-age=3600');
  }
}

async function regularFileInside(root: string, candidate: string) {
  try {
    const candidateStat = await stat(candidate);
    if (!candidateStat.isFile()) return null;
    const canonical = await realpath(candidate);
    if (canonical !== root && !canonical.startsWith(`${root}${path.sep}`)) return null;
    return canonical;
  } catch {
    return null;
  }
}

export async function registerCmsStaticRoutes(fastify: FastifyInstance, staticDirectory?: string) {
  if (!staticDirectory) return;

  const canonicalRoot = await realpath(staticDirectory);
  const rootStat = await stat(canonicalRoot);
  if (!rootStat.isDirectory()) {
    throw new Error('CMS_STATIC_DIR must reference a readable directory');
  }
  const indexPath = await regularFileInside(canonicalRoot, path.join(canonicalRoot, 'index.html'));
  if (!indexPath) throw new Error('CMS_STATIC_DIR must contain index.html');

  const serve = async (request: FastifyRequest, reply: FastifyReply) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      throw AppError.badRequest('Invalid URL path');
    }

    if (isReservedPath(pathname) || pathname.includes('\0')) {
      throw AppError.notFound('Route not found');
    }

    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = path.resolve(canonicalRoot, requested);
    const insideRoot = candidate === canonicalRoot || candidate.startsWith(`${canonicalRoot}${path.sep}`);
    let filePath = insideRoot ? await regularFileInside(canonicalRoot, candidate) : null;

    const wantsHtml = request.headers.accept?.includes('text/html') ?? false;
    if (!filePath && wantsHtml && path.extname(pathname) === '') {
      filePath = indexPath;
      pathname = '/index.html';
    }
    if (!filePath) throw AppError.notFound('Route not found');

    setCacheHeaders(reply, pathname);
    reply.type(MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(createReadStream(filePath));
  };

  fastify.get('/', serve);
  fastify.get('/*', serve);
}
