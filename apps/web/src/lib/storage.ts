import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import crypto from 'crypto';

export interface StorageServiceOptions {
  mock?: boolean;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  s3Client?: S3Client;
}

export interface UploadResult {
  key: string;
  etag?: string;
  url: string;
}

export class StorageService {
  private isMockMode: boolean;
  private bucket: string;
  private region: string;
  private endpoint?: string;
  private accessKeyId?: string;
  private secretAccessKey?: string;
  private client?: S3Client;
  private mockStore = new Map<string, { data: Buffer; contentType: string; updatedAt: Date }>();

  constructor(options: StorageServiceOptions = {}) {
    const envMock = process.env.USE_MOCK_STORAGE === 'true' || process.env.NODE_ENV === 'test';
    const envBucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET;
    const envRegion = process.env.AWS_REGION || process.env.S3_REGION || 'us-east-1';
    const envAccessKey = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
    const envSecretKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
    const envEndpoint = process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT_URL;

    this.bucket = options.bucket || envBucket || 'clip-capture-clips';
    this.region = options.region || envRegion;
    this.endpoint = options.endpoint || envEndpoint;
    this.accessKeyId = options.accessKeyId || envAccessKey;
    this.secretAccessKey = options.secretAccessKey || envSecretKey;

    // Use mock mode if explicitly requested or if credentials/bucket are missing
    if (options.mock !== undefined) {
      this.isMockMode = options.mock;
    } else if (envMock && !envAccessKey && !envSecretKey) {
      this.isMockMode = true;
    } else if (!envAccessKey || !envSecretKey) {
      this.isMockMode = true;
    } else {
      this.isMockMode = false;
    }

    if (!this.isMockMode) {
      this.client =
        options.s3Client ||
        new S3Client({
          region: this.region,
          endpoint: this.endpoint,
          credentials:
            this.accessKeyId && this.secretAccessKey
              ? {
                  accessKeyId: this.accessKeyId,
                  secretAccessKey: this.secretAccessKey,
                }
              : undefined,
        });
    }
  }

  public isMock(): boolean {
    return this.isMockMode;
  }

  public resetMock(): void {
    this.mockStore.clear();
  }

  /**
   * Upload an object directly to S3 or mock storage
   */
  public async uploadObject(
    key: string,
    data: Buffer | Uint8Array | string,
    contentType: string = 'video/mp4',
  ): Promise<UploadResult> {
    const buffer = Buffer.isBuffer(data)
      ? data
      : typeof data === 'string'
        ? Buffer.from(data)
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

    if (this.isMockMode || !this.client) {
      this.mockStore.set(key, {
        data: buffer,
        contentType,
        updatedAt: new Date(),
      });
      return {
        key,
        etag: `"${crypto.createHash('md5').update(buffer).digest('hex')}"`,
        url: `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`,
      };
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    const response = await this.client.send(command);
    return {
      key,
      etag: response.ETag,
      url: `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`,
    };
  }

  /**
   * Generate presigned PUT URL for client-direct uploads
   */
  public async getPresignedPutUrl(
    key: string,
    expiresInSeconds: number = 3600,
    contentType: string = 'video/mp4',
  ): Promise<string> {
    if (this.isMockMode || !this.client || !this.accessKeyId || !this.secretAccessKey) {
      return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}?mock-presigned=put&expires=${Date.now() + expiresInSeconds * 1000}`;
    }

    return this.generatePresignedUrl('PUT', key, expiresInSeconds, contentType);
  }

  /**
   * Generate presigned GET URL for authenticated clip playback / download
   */
  public async getPresignedGetUrl(
    key: string,
    expiresInSeconds: number = 3600,
  ): Promise<string> {
    if (this.isMockMode || !this.client || !this.accessKeyId || !this.secretAccessKey) {
      return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}?mock-presigned=get&expires=${Date.now() + expiresInSeconds * 1000}`;
    }

    return this.generatePresignedUrl('GET', key, expiresInSeconds);
  }

  /**
   * Retrieve stored object bytes (useful in tests and verification)
   */
  public async getObject(key: string): Promise<Buffer | null> {
    if (this.isMockMode || !this.client) {
      const item = this.mockStore.get(key);
      return item ? item.data : null;
    }

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      if (!response.Body) return null;
      const byteArray = await response.Body.transformToByteArray();
      return Buffer.from(byteArray);
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Check if object exists in storage
   */
  public async hasObject(key: string): Promise<boolean> {
    if (this.isMockMode || !this.client) {
      return this.mockStore.has(key);
    }

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Delete object from storage
   */
  public async deleteObject(key: string): Promise<boolean> {
    if (this.isMockMode || !this.client) {
      return this.mockStore.delete(key);
    }

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * SigV4 URL signer
   */
  private generatePresignedUrl(
    method: 'GET' | 'PUT',
    key: string,
    expiresInSeconds: number,
    contentType?: string,
  ): string {
    const host = this.endpoint
      ? new URL(this.endpoint).host
      : `${this.bucket}.s3.${this.region}.amazonaws.com`;
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    const encodedKey = encodeURIComponent(cleanKey).replace(/%2F/g, '/');
    const endpointUrl = this.endpoint
      ? `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${encodedKey}`
      : `https://${host}/${encodedKey}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const queryParams: [string, string][] = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${this.accessKeyId}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', expiresInSeconds.toString()],
      ['X-Amz-SignedHeaders', 'host'],
    ];

    queryParams.sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQuery = queryParams
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const canonicalHeaders = `host:${host}\n`;
    const canonicalRequest = [
      method,
      `/${encodedKey}`,
      canonicalQuery,
      canonicalHeaders,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const hashedCanonicalRequest = crypto
      .createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      hashedCanonicalRequest,
    ].join('\n');

    const kDate = crypto
      .createHmac('sha256', `AWS4${this.secretAccessKey}`)
      .update(dateStamp)
      .digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(this.region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const signingKey = crypto.createHmac('sha256', kService).update('aws4_request').digest();

    const signature = crypto
      .createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex');

    return `${endpointUrl}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}

// Global singleton instance
const globalForStorage = globalThis as unknown as {
  storageService: StorageService | undefined;
};

export const storageService =
  globalForStorage.storageService ?? new StorageService();

if (process.env.NODE_ENV !== 'production') {
  globalForStorage.storageService = storageService;
}
