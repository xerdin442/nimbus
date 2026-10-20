import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { WEBHOOK_EVENTS, type WebhookEventType } from '../webhook-events';

const urlOptions = {
  protocols: ['http', 'https'],
  require_protocol: true,
  // Test endpoints point at localhost during development.
  require_tld: false,
};

export class CreateWebhookEndpointDto {
  @IsUrl(urlOptions)
  @MaxLength(2000)
  url: string;

  /** The events this endpoint receives; anything else stays unannounced. */
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events: WebhookEventType[];
}

export class UpdateWebhookEndpointDto {
  @IsOptional()
  @IsUrl(urlOptions)
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events?: WebhookEventType[];

  /** Disabled endpoints stop receiving deliveries but keep their history. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
