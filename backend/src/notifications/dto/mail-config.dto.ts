import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MAIL_PROVIDERS } from '@src/db/schema/types';
import type { MailProvider } from '@src/db/schema/types';

export class ConnectMailConfigDto {
  @IsIn(MAIL_PROVIDERS)
  provider: MailProvider;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey: string;

  @IsEmail()
  fromEmail: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fromName: string;

  @IsOptional()
  @IsEmail()
  replyTo?: string;
}
