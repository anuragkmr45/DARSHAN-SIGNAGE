import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions as HttpsRequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config as appConfig } from '@/config';
import { MaintenanceOutcomeUncertainError } from '@/maintenance';

export interface MediaUploadGatewayOptions {
  endpoint?: string;
  port?: number;
  useSsl?: boolean;
}

export interface ResolvedGatewayOptions {
  endpoint: string;
  port: number;
  useSsl: boolean;
}

export function buildMediaGatewayRequestOptions(
  request: Pick<FastifyRequest, 'headers' | 'method' | 'raw'>,
  gateway: ResolvedGatewayOptions,
  method = request.method
): HttpsRequestOptions {
  return {
    protocol: gateway.useSsl ? 'https:' : 'http:',
    hostname: gateway.endpoint,
    port: gateway.port,
    method,
    path: request.raw.url,
    headers: upstreamHeaders(request as FastifyRequest),
    // SigV4 requires the public CMS Host header, while TLS must authenticate
    // the private Data-VM identity. Node otherwise derives SNI from Host.
    ...(gateway.useSsl ? { servername: isIP(gateway.endpoint) ? '' : gateway.endpoint } : {}),
  };
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function upstreamHeaders(request: FastifyRequest): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    // Browser credentials are never object-store credentials. Presigned SigV4
    // remains entirely in the path/query and its signed Host header.
    if (name.toLowerCase() === 'cookie' || name.toLowerCase() === 'authorization') continue;
    headers[name] = value;
  }
  return headers;
}

function responseHeaders(response: IncomingMessage): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  return headers;
}

async function proxyStagingPut(
  request: FastifyRequest,
  reply: FastifyReply,
  gateway: ResolvedGatewayOptions
): Promise<void> {
  const body = request.body as Readable | undefined;
  if (!body || typeof body.pipe !== 'function') {
    throw new Error('Upload gateway did not receive a streaming request body.');
  }
  // raw.url retains the exact encoded path and SigV4 query. Never parse and
  // rebuild it: even equivalent encoding would invalidate the signature.
  const options = buildMediaGatewayRequestOptions(request, gateway, 'PUT');
  const transport = gateway.useSsl ? httpsRequest : httpRequest;
  let upstreamResponse: IncomingMessage;
  let responseResolve!: (response: IncomingMessage) => void;
  let responseReject!: (error: Error) => void;
  const responsePromise = new Promise<IncomingMessage>((resolveResponse, rejectResponse) => {
    responseResolve = resolveResponse;
    responseReject = rejectResponse;
  });
  const upstream = transport(options, responseResolve);
  upstream.once('error', responseReject);
  const abortUpstream = () => upstream.destroy(new Error('Browser upload connection was aborted.'));
  request.raw.once('aborted', abortUpstream);

  let uploadError: unknown;
  try {
    await pipeline(body, upstream).catch((error) => { uploadError = error; });
    try {
      upstreamResponse = await responsePromise;
    } catch (responseError) {
      throw new MaintenanceOutcomeUncertainError(
        'The upload gateway lost the MinIO result after streaming bytes.',
        {
          path: request.raw.url?.split('?')[0] ?? '/media-staging',
          cause: responseError instanceof Error ? responseError.message : String(responseError),
        }
      );
    }
    // Some object stores reject a signed request before consuming its complete
    // body. A definitive HTTP response is authoritative even if the request
    // stream then reports EPIPE; without a response the outcome was uncertain.
    if (uploadError && upstreamResponse.statusCode === undefined) {
      throw new MaintenanceOutcomeUncertainError('The upload gateway could not determine the PUT outcome.');
    }
    reply.hijack();
    reply.raw.writeHead(
      upstreamResponse.statusCode ?? 502,
      upstreamResponse.statusMessage,
      responseHeaders(upstreamResponse)
    );
    await pipeline(upstreamResponse, reply.raw);
  } finally {
    request.raw.removeListener('aborted', abortUpstream);
    upstream.removeListener('error', responseReject);
  }
}

async function proxyObjectRead(
  request: FastifyRequest,
  reply: FastifyReply,
  gateway: ResolvedGatewayOptions
): Promise<void> {
  const options = buildMediaGatewayRequestOptions(request, gateway);
  const transport = gateway.useSsl ? httpsRequest : httpRequest;
  const upstreamResponse = await new Promise<IncomingMessage>((resolveResponse, rejectResponse) => {
    const upstream = transport(options, resolveResponse);
    upstream.once('error', rejectResponse);
    upstream.end();
  });
  reply.hijack();
  reply.raw.writeHead(
    upstreamResponse.statusCode ?? 502,
    upstreamResponse.statusMessage,
    responseHeaders(upstreamResponse)
  );
  await pipeline(upstreamResponse, reply.raw);
}

/**
 * Same-origin browser PUTs enter here from the CMS Nginx gateway. Fastify's
 * maintenance handler wrapper owns the admission permit until both request and
 * MinIO response streams settle. GET/HEAD media delivery never enters here.
 */
export async function mediaUploadGatewayRoutes(
  fastify: FastifyInstance,
  options: MediaUploadGatewayOptions = {}
): Promise<void> {
  const gateway: ResolvedGatewayOptions = {
    endpoint: options.endpoint ?? appConfig.MINIO_ENDPOINT,
    port: options.port ?? appConfig.MINIO_PORT,
    useSsl: options.useSsl ?? appConfig.MINIO_USE_SSL,
  };
  fastify.addContentTypeParser('*', (request, payload, done) => {
    void request;
    done(null, payload);
  });
  fastify.put('/media-staging/*', {
    bodyLimit: appConfig.MAX_UPLOAD_MB * 1024 * 1024,
  }, (request, reply) => proxyStagingPut(request, reply, gateway));
  // The legacy endpoint still issues media-source PUT signatures. It remains
  // supported for this release, but it no longer bypasses maintenance. Reads
  // on this bucket are proxied without admission so the same path can preserve
  // existing playback/CMS URLs.
  fastify.put('/media-source/*', {
    bodyLimit: appConfig.MAX_UPLOAD_MB * 1024 * 1024,
  }, (request, reply) => proxyStagingPut(request, reply, gateway));
  fastify.get('/media-source/*', { exposeHeadRoute: false }, (request, reply) => proxyObjectRead(request, reply, gateway));
  fastify.head('/media-source/*', (request, reply) => proxyObjectRead(request, reply, gateway));
}

