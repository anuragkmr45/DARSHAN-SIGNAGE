import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand, CreateBucketCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListPartsCommand, CopyObjectCommand, } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { config as appConfig } from '../config/index.js';
import { HTTP_STATUS } from '../http-status-codes.js';
import { observeS3Operation } from '../observability/metrics.js';
const { NOT_FOUND } = HTTP_STATUS;
let s3Client = null;
let recipientS3Client = null;
function createS3Client(endpoint) {
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
function getInternalEndpoint() {
    return `http${appConfig.MINIO_USE_SSL ? 's' : ''}://${appConfig.MINIO_ENDPOINT}:${appConfig.MINIO_PORT}`;
}
export function initializeS3() {
    if (appConfig.NODE_ENV === 'production' && !appConfig.MINIO_PUBLIC_ENDPOINT) {
        throw new Error('MINIO_PUBLIC_ENDPOINT is required in production so browser and player transfers stay on the CMS HTTPS media gateway.');
    }
    s3Client = createS3Client(getInternalEndpoint());
    recipientS3Client = appConfig.MINIO_PUBLIC_ENDPOINT
        ? createS3Client(appConfig.MINIO_PUBLIC_ENDPOINT)
        : s3Client;
    return s3Client;
}
export function getS3Client() {
    if (!s3Client) {
        throw new Error('S3 client not initialized. Call initializeS3() first.');
    }
    return s3Client;
}
/**
 * Presigned URLs leave the Backend trust boundary and must use the recipient-
 * accessible media gateway. Internal S3 operations continue to use s3Client.
 * The audience remains explicit at call sites so distinct recipient gateways
 * can be introduced later without changing the media APIs.
 */
export function getS3ClientForAudience(audience = 'device') {
    if (!recipientS3Client) {
        throw new Error('S3 client not initialized. Call initializeS3() first.');
    }
    void audience;
    return recipientS3Client;
}
export async function createBucketIfNotExists(bucketName) {
    const client = getS3Client();
    try {
        // Check if bucket exists using HeadBucketCommand
        await observeS3Operation('head_bucket', () => client.send(new HeadBucketCommand({ Bucket: bucketName })));
    }
    catch (error) {
        // If bucket doesn't exist (404), create it
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === NOT_FOUND) {
            try {
                await observeS3Operation('create_bucket', () => client.send(new CreateBucketCommand({ Bucket: bucketName })));
            }
            catch (createError) {
                // A second bootstrap/runtime may create the bucket between HeadBucket
                // and CreateBucket. That is a successful idempotent outcome only when
                // MinIO confirms this credential already owns the bucket.
                if (createError?.name !== 'BucketAlreadyOwnedByYou' && createError?.Code !== 'BucketAlreadyOwnedByYou') {
                    throw createError;
                }
            }
        }
        else {
            // For other errors (like connection errors), throw them
            throw error;
        }
    }
}
export async function putObject(bucket, key, body, contentType) {
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
export async function putFile(bucket, key, filePath, contentType) {
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
export async function putJson(bucket, key, data) {
    return putObject(bucket, key, JSON.stringify(data), 'application/json');
}
export async function getObject(bucket, key) {
    const client = getS3Client();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await observeS3Operation('get_object', () => client.send(command));
    if (!response.Body) {
        throw new Error('Empty response body');
    }
    const chunks = [];
    for await (const chunk of response.Body) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
/** Stream an object through SHA-256 without retaining an operator upload in memory. */
export async function computeObjectSha256(bucket, key) {
    const client = getS3Client();
    const response = await observeS3Operation('get_object', () => client.send(new GetObjectCommand({ Bucket: bucket, Key: key })));
    if (!response.Body) {
        throw new Error('Empty response body');
    }
    const hash = createHash('sha256');
    for await (const chunk of response.Body) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}
export async function deleteObject(bucket, key) {
    const client = getS3Client();
    await observeS3Operation('delete_object', () => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })));
}
export async function headObject(bucket, key) {
    const client = getS3Client();
    return observeS3Operation('head_object', () => client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })));
}
export async function getPresignedUrl(bucket, key, expiresInOrOptions = 3600) {
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
export async function getPresignedPutUrl(bucket, key, expiresIn = 3600, audience = 'device') {
    const client = getS3ClientForAudience(audience);
    const command = new PutObjectCommand({ Bucket: bucket, Key: key });
    return observeS3Operation('presign_put', () => getSignedUrl(client, command, { expiresIn }));
}
export async function createMultipartUpload(params) {
    const client = getS3Client();
    const command = new CreateMultipartUploadCommand({
        Bucket: params.bucket,
        Key: params.key,
        ContentType: params.contentType,
        Metadata: { 'x-sha256': params.checksumSha256 },
    });
    return await observeS3Operation('put_object', () => client.send(command));
}
export async function getPresignedUploadPartUrl(params) {
    const client = getS3ClientForAudience(params.audience ?? 'device');
    const command = new UploadPartCommand({
        Bucket: params.bucket,
        Key: params.key,
        UploadId: params.uploadId,
        PartNumber: params.partNumber,
    });
    return await observeS3Operation('presign_put', () => getSignedUrl(client, command, { expiresIn: params.expiresIn ?? 900 }));
}
export async function listMultipartUploadParts(bucket, key, uploadId) {
    return await observeS3Operation('head_object', () => getS3Client().send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId })));
}
export async function completeMultipartUpload(params) {
    return await observeS3Operation('put_object', () => getS3Client().send(new CompleteMultipartUploadCommand({
        Bucket: params.bucket,
        Key: params.key,
        UploadId: params.uploadId,
        MultipartUpload: {
            Parts: params.parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
    })));
}
export async function abortMultipartUpload(bucket, key, uploadId) {
    await observeS3Operation('delete_object', () => getS3Client().send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })));
}
function encodeCopySource(bucket, key) {
    return `${encodeURIComponent(bucket)}/${key.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;
}
export async function copyObject(params) {
    await observeS3Operation('put_object', () => getS3Client().send(new CopyObjectCommand({
        Bucket: params.destinationBucket,
        Key: params.destinationKey,
        CopySource: encodeCopySource(params.sourceBucket, params.sourceKey),
    })));
}
export function computeSha256(data) {
    const buffer = typeof data === 'string' ? Buffer.from(data) : data;
    return createHash('sha256').update(buffer).digest('hex');
}
