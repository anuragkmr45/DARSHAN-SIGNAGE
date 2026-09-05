import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { config as appConfig } from '@/config';
import { HTTP_STATUS } from '@/http-status-codes';
import { observeS3Operation } from '@/observability/metrics';

const { NOT_FOUND } = HTTP_STATUS;

let s3Client: S3Client | null = null;
let publicS3Client: S3Client | null = null;

export type S3UrlAudience = 'cms' | 'device';

function createS3Client(endpoint: string): S3Client {
  return new S3Client({
    region: appConfig.MINIO_REGION,
    endpoint,
    credentials: {
      accessKeyId: appConfig.MINIO_ACCESS_KEY,
      secretAccessKey: appConfig.MINIO_SECRET_KEY,
    },
    forcePathStyle: true,
  });
}

function getInternalEndpoint(): string {
  return `http${appConfig.MINIO_USE_SSL ? 's' : ''}://${appConfig.MINIO_ENDPOINT}:${appConfig.MINIO_PORT}`;
}

export function initializeS3(): S3Client {
  if (appConfig.NODE_ENV === 'production' && !appConfig.MINIO_PUBLIC_ENDPOINT) {
    throw new Error(
      'MINIO_PUBLIC_ENDPOINT is required in production so CMS browser transfers stay on the CMS gateway origin.'
    );
  }

  s3Client = createS3Client(getInternalEndpoint());
  publicS3Client = appConfig.MINIO_PUBLIC_ENDPOINT ? createS3Client(appConfig.MINIO_PUBLIC_ENDPOINT) : null;

  return s3Client;
}

export function getS3Client(): S3Client {
  if (!s3Client) {
    throw new Error('S3 client not initialized. Call initializeS3() first.');
  }
  return s3Client;
}

/**
 * Returns a signer whose host matches the intended recipient. CMS browser
 * transfers are signed for the public Nginx gateway; player traffic continues
 * to receive URLs for the device-accessible object endpoint.
 */
export function getS3ClientForAudience(audience: S3UrlAudience = 'device'): S3Client {
  if (audience === 'cms' && publicS3Client) {
    return publicS3Client;
  }
  return getS3Client();
}

export async function createBucketIfNotExists(bucketName: string): Promise<void> {
  const client = getS3Client();

  try {
    // Check if bucket exists using HeadBucketCommand
    await observeS3Operation('head_bucket', () => client.send(new HeadBucketCommand({ Bucket: bucketName })));
  } catch (error: any) {
    // If bucket doesn't exist (404), create it
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === NOT_FOUND) {
      try {
        await observeS3Operation('create_bucket', () => client.send(new CreateBucketCommand({ Bucket: bucketName })));
      } catch (createError: any) {
        // A second bootstrap/runtime may create the bucket between HeadBucket
        // and CreateBucket. That is a successful idempotent outcome only when
        // MinIO confirms this credential already owns the bucket.
        if (createError?.name !== 'BucketAlreadyOwnedByYou' && createError?.Code !== 'BucketAlreadyOwnedByYou') {
          throw createError;
        }
      }
    } else {
      // For other errors (like connection errors), throw them
      throw error;
    }
  }
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer | string,
  contentType?: string
): Promise<{ etag: string; sha256: string }> {
  const client = getS3Client();
  const bodyBuffer = typeof body === 'string' ? Buffer.from(body) : body;
  const sha256 = createHash('sha256').update(bodyBuffer).digest('hex');

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bodyBuffer,
    ContentType: contentType,
    Metadata: {
      'x-sha256': sha256,
    },
  });

  const response = await observeS3Operation('put_object', () => client.send(command));
  return {
    etag: response.ETag || '',
    sha256,
  };
}

/**
 * Upload a file without materializing the complete payload in the API/worker
 * heap. The hash is calculated in a first streaming pass so object metadata
 * remains equivalent to putObject while the upload remains bounded by stream
 * buffering rather than archive size.
 */
export async function putFile(
  bucket: string,
  key: string,
  filePath: string,
  contentType?: string
): Promise<{ etag: string; sha256: string }> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  const sha256 = hash.digest('hex');
  const client = getS3Client();
  const response = await observeS3Operation('put_object', () => client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(filePath),
    ContentType: contentType,
    Metadata: { 'x-sha256': sha256 },
  })));
  return { etag: response.ETag || '', sha256 };
}

export async function putJson(bucket: string, key: string, data: any): Promise<{ etag: string; sha256: string }> {
  return putObject(bucket, key, JSON.stringify(data), 'application/json');
}

export async function getObject(bucket: string, key: string): Promise<Buffer> {
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await observeS3Operation('get_object', () => client.send(command));

  if (!response.Body) {
    throw new Error('Empty response body');
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/** Stream an object through SHA-256 without retaining an operator upload in memory. */
export async function computeObjectSha256(bucket: string, key: string): Promise<string> {
  const client = getS3Client();
  const response = await observeS3Operation('get_object', () => client.send(new GetObjectCommand({ Bucket: bucket, Key: key })));
  if (!response.Body) {
    throw new Error('Empty response body');
  }

  const hash = createHash('sha256');
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  const client = getS3Client();
  await observeS3Operation('delete_object', () => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })));
}

export async function headObject(bucket: string, key: string): Promise<any> {
  const client = getS3Client();
  return observeS3Operation('head_object', () => client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })));
}

export interface PresignedGetUrlOptions {
  expiresIn?: number;
  responseContentDisposition?: string;
  responseContentType?: string;
  audience?: S3UrlAudience;
}

export async function getPresignedUrl(
  bucket: string,
  key: string,
  expiresInOrOptions: number | PresignedGetUrlOptions = 3600
): Promise<string> {
  const options = typeof expiresInOrOptions === 'number' ? { expiresIn: expiresInOrOptions } : expiresInOrOptions;
  const client = getS3ClientForAudience(options.audience);
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: options.responseContentDisposition,
    ResponseContentType: options.responseContentType,
  });
  return observeS3Operation('presign_get', () => getSignedUrl(client, command, { expiresIn: options.expiresIn ?? 3600 }));
}

export async function getPresignedPutUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600,
  audience: S3UrlAudience = 'device'
): Promise<string> {
  const client = getS3ClientForAudience(audience);
  const command = new PutObjectCommand({ Bucket: bucket, Key: key });
  return observeS3Operation('presign_put', () => getSignedUrl(client, command, { expiresIn }));
}

export async function createMultipartUpload(params: {
  bucket: string;
  key: string;
  contentType: string;
  checksumSha256: string;
}) {
  const client = getS3Client();
  const command = new CreateMultipartUploadCommand({
    Bucket: params.bucket,
    Key: params.key,
    ContentType: params.contentType,
    Metadata: { 'x-sha256': params.checksumSha256 },
  });
  return await observeS3Operation('put_object', () => client.send(command));
}

export async function getPresignedUploadPartUrl(params: {
  bucket: string;
  key: string;
  uploadId: string;
  partNumber: number;
  expiresIn?: number;
  audience?: S3UrlAudience;
}) {
  const client = getS3ClientForAudience(params.audience ?? 'device');
  const command = new UploadPartCommand({
    Bucket: params.bucket,
    Key: params.key,
    UploadId: params.uploadId,
    PartNumber: params.partNumber,
  });
  return await observeS3Operation('presign_put', () => getSignedUrl(client, command, { expiresIn: params.expiresIn ?? 900 }));
}

export async function listMultipartUploadParts(bucket: string, key: string, uploadId: string) {
  return await observeS3Operation('head_object', () =>
    getS3Client().send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
  );
}

export async function completeMultipartUpload(params: {
  bucket: string;
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}) {
  return await observeS3Operation('put_object', () =>
    getS3Client().send(
      new CompleteMultipartUploadCommand({
        Bucket: params.bucket,
        Key: params.key,
        UploadId: params.uploadId,
        MultipartUpload: {
          Parts: params.parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      })
    )
  );
}

export async function abortMultipartUpload(bucket: string, key: string, uploadId: string) {
  await observeS3Operation('delete_object', () =>
    getS3Client().send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
  );
}

function encodeCopySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;
}

export async function copyObject(params: { sourceBucket: string; sourceKey: string; destinationBucket: string; destinationKey: string }) {
  await observeS3Operation('put_object', () =>
    getS3Client().send(
      new CopyObjectCommand({
        Bucket: params.destinationBucket,
        Key: params.destinationKey,
        CopySource: encodeCopySource(params.sourceBucket, params.sourceKey),
      })
    )
  );
}

export function computeSha256(data: Buffer | string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data) : data;
  return createHash('sha256').update(buffer).digest('hex');
}
