import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** Send the QR `token` from a camera scan, or the ticket `code` typed in by hand. */
export class ScanTicketDto {
  /** The location the scanner is at. */
  @IsUUID()
  locationId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  token?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9 -]{4,30}$/, {
    message: 'code must be the code printed on the ticket',
  })
  code?: string;
}
