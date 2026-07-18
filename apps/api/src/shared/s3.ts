import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

export const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
  forcePathStyle: true, // MinIO
});

export const BUCKETS = {
  audio: config.S3_BUCKET_AUDIO,
  art: config.S3_BUCKET_ART,
  uploads: config.S3_BUCKET_UPLOADS,
} as const;

export async function presignPut(
  bucket: string,
  key: string,
  contentType: string,
  expiresIn = config.SIGNED_URL_TTL,
): Promise<string> {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
    expiresIn,
  });
}

export async function presignGet(bucket: string, key: string, expiresIn = config.SIGNED_URL_TTL): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export interface RangedObject {
  body: Readable;
  contentLength: number;
  contentRange?: string;
  contentType?: string;
}

/** Fetch an object (optionally a byte range) as a Node stream for proxying. */
export async function getObjectStream(bucket: string, key: string, range?: string): Promise<RangedObject> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
  return {
    body: res.Body as Readable,
    contentLength: res.ContentLength ?? 0,
    contentRange: res.ContentRange,
    contentType: res.ContentType,
  };
}

export async function headObject(bucket: string, key: string) {
  return s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function putObject(bucket: string, key: string, body: Buffer | Readable, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function deleteObject(bucket: string, key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Public URL for objects in the world-readable art bucket. */
export function publicArtUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return `${config.S3_PUBLIC_URL}/${BUCKETS.art}/${key}`;
}
