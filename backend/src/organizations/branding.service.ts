import { HttpStatus, Injectable } from '@nestjs/common';
import { CodedException } from '@src/common/errors';
import { Logger } from '@src/common/logger';
import { CloudinaryService } from '@src/common/uploads/cloudinary.service';
import type {
  Asset,
  OrgSettingsInternal,
  OrgSettingsView,
  TenantContext,
} from '@src/common/types';
import { UpdateBrandingDto } from './dto/branding.dto';
import { OrgSettingsService } from './org-settings.service';

const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
];

@Injectable()
export class BrandingService {
  private readonly logger = Logger(BrandingService.name);

  constructor(
    private readonly settings: OrgSettingsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async updateSocials(
    ctx: TenantContext,
    dto: UpdateBrandingDto,
  ): Promise<OrgSettingsView> {
    const values = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<OrgSettingsInternal>;
    return this.settings.updateBranding(ctx, values);
  }

  async upload(
    ctx: TenantContext,
    file: Express.Multer.File | undefined,
    asset: Asset,
  ): Promise<OrgSettingsView> {
    this.assertImage(file);

    const current = await this.settings.getInternal(ctx);
    const uploaded = await this.cloudinary
      .uploadImage(file.buffer, {
        folder: `nimbus/orgs/${ctx.orgId}/branding`,
        name: asset,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Branding upload for org ${ctx.orgId} failed: ${String(error)}`,
        );
        throw new CodedException(
          HttpStatus.BAD_GATEWAY,
          'image_upload_failed',
          'Could not upload the image; please try again',
        );
      });

    let view: OrgSettingsView;
    try {
      view = await this.settings.updateBranding(
        ctx,
        asset === 'logo'
          ? {
              companyLogo: uploaded.url,
              companyLogoPublicId: uploaded.publicId,
            }
          : {
              emailHeaderImage: uploaded.url,
              emailHeaderImagePublicId: uploaded.publicId,
            },
      );
    } catch (error) {
      await this.destroy(uploaded.publicId);
      throw error;
    }

    await this.destroy(this.publicIdOf(current, asset));
    return view;
  }

  async remove(ctx: TenantContext, asset: Asset): Promise<OrgSettingsView> {
    const current = await this.settings.getInternal(ctx);
    const view = await this.settings.updateBranding(
      ctx,
      asset === 'logo'
        ? { companyLogo: null, companyLogoPublicId: null }
        : { emailHeaderImage: null, emailHeaderImagePublicId: null },
    );
    await this.destroy(this.publicIdOf(current, asset));
    return view;
  }

  private assertImage(
    file: Express.Multer.File | undefined,
  ): asserts file is Express.Multer.File {
    if (!file) {
      throw new CodedException(
        HttpStatus.BAD_REQUEST,
        'image_required',
        'Attach an image file in the `file` field',
      );
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new CodedException(
        HttpStatus.BAD_REQUEST,
        'invalid_image',
        'Use a PNG, JPEG, WebP or HEIC image',
      );
    }
  }

  private publicIdOf(
    settings: OrgSettingsInternal,
    asset: Asset,
  ): string | null {
    return asset === 'logo'
      ? settings.companyLogoPublicId
      : settings.emailHeaderImagePublicId;
  }

  private async destroy(publicId: string | null): Promise<void> {
    if (!publicId) return;
    try {
      await this.cloudinary.destroy(publicId);
    } catch (error) {
      this.logger.warn(
        `Failed to delete Cloudinary asset ${publicId}: ${String(error)}`,
      );
    }
  }
}
