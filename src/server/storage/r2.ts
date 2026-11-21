import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  assertValidKey,
  assertValidPrefix,
  type ListedObject,
  type ObjectStore,
  type PutOptions,
  type PutResult,
} from "@/server/storage/types";

export interface R2Settings {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * The Cloudflare R2 bucket, through R2's S3 interface. Pointed at Amazon S3
 * instead, the same code would work there.
 *
 * Safe writes depend on R2 honoring `If-Match` and `If-None-Match` on
 * PutObject. `npm run check:r2` confirms that against the real bucket (see
 * the spec's Phase 0).
 */
export function r2ObjectStore(settings: R2Settings): ObjectStore {
  const client = new S3Client({
    region: "auto",
    endpoint: settings.endpoint,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    // Only send checksums when an operation requires one. Newer SDKs add them
    // to every upload by default, which S3-compatible services don't all accept.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = settings.bucket;

  async function listObjects(prefix: string): Promise<ListedObject[]> {
    assertValidPrefix(prefix);
    const objects: ListedObject[] = [];
    let ContinuationToken: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix || undefined, ContinuationToken }));
      // With no date given, count it as new: sweeps only delete what's old.
      for (const item of page.Contents ?? []) if (item.Key) objects.push({ key: item.Key, modified: item.LastModified ?? new Date() });
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return objects;
  }

  return {
    async get(key) {
      assertValidKey(key);
      try {
        const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!result.Body || !result.ETag) throw new Error(`R2 returned no body or ETag for ${key}`);
        return { body: await result.Body.transformToByteArray(), etag: result.ETag, contentType: result.ContentType };
      } catch (error) {
        if (isStatus(error, 404)) return null;
        throw error;
      }
    },

    async put(key, body, options: PutOptions = {}): Promise<PutResult> {
      assertValidKey(key);
      const condition = options.condition;
      try {
        const result = await client.send(
          new PutObjectCommand({
            Bucket,
            Key: key,
            Body: body,
            ContentType: options.contentType,
            CacheControl: options.cacheControl,
            IfMatch: condition && "ifMatch" in condition ? condition.ifMatch : undefined,
            IfNoneMatch: condition && "ifNoneMatch" in condition ? condition.ifNoneMatch : undefined,
          }),
        );
        if (!result.ETag) throw new Error(`R2 returned no ETag after writing ${key}`);
        return { ok: true, etag: result.ETag };
      } catch (error) {
        // 412: the condition didn't hold. 409: another conditional write to the
        // same key was in progress (S3 asks the caller to re-read and retry).
        if (condition && (isStatus(error, 412) || isStatus(error, 409))) return { ok: false, reason: "conflict" };
        throw error;
      }
    },

    async delete(key) {
      assertValidKey(key);
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    async list(prefix) {
      return (await listObjects(prefix)).map((object) => object.key);
    },

    listObjects,
  };
}

function isStatus(error: unknown, status: number): boolean {
  if (error instanceof S3ServiceException && error.$metadata?.httpStatusCode === status) return true;
  const meta = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata;
  return meta?.httpStatusCode === status;
}
