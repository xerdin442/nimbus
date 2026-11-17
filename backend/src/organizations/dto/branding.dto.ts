import { IsOptional, IsUrl, MaxLength } from 'class-validator';

const URL_OPTIONS = {
  require_protocol: true,
  protocols: ['http', 'https'],
};

export class UpdateBrandingDto {
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(300)
  tiktok?: string | null;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(300)
  instagram?: string | null;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(300)
  facebook?: string | null;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(300)
  twitter?: string | null;
}
