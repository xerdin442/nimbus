import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { v2 } from 'cloudinary';
import { Secrets } from '@src/common/secrets';
import { Asset } from '../types';

export interface UploadedImage {
  url: string;
  publicId: string;
}

export interface UploadImageInput {
  folder: `nimbus/orgs/${string}/branding`;
  name: Asset;
}

@Injectable()
export class CloudinaryService {
  constructor() {
    v2.config({
      cloud_name: Secrets.CLOUDINARY_CLOUD_NAME,
      api_key: Secrets.CLOUDINARY_API_KEY,
      api_secret: Secrets.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  uploadImage(buffer: Buffer, input: UploadImageInput): Promise<UploadedImage> {
    const publicId = `${input.name}-${Date.now()}-${randomUUID()
      .replace(/-/g, '')
      .slice(0, 12)}`;

    return new Promise((resolve, reject) => {
      const stream = v2.uploader.upload_stream(
        {
          folder: input.folder,
          public_id: publicId,
          overwrite: false,
          resource_type: 'image',
        },
        (error, result) => {
          if (error || !result) {
            reject(
              new Error(
                error?.message ??
                  'Cloudinary returned no result for the upload',
              ),
            );
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }

  async destroy(publicId: string): Promise<void> {
    await v2.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
    });
  }

  /** A delivery URL capped to `width`; email clients don't need to download the full-size asset. */
  imageUrl(publicId: string, width: number): string {
    return v2.url(publicId, { secure: true, width, crop: 'limit' });
  }
}
