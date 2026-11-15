import { IsEmail, IsOptional, IsUUID } from 'class-validator';

export class SubscribeDto {
  @IsUUID()
  planId: string;

  @IsOptional()
  @IsEmail()
  billingEmail?: string;
}

export class ChangePlanDto {
  @IsUUID()
  planId: string;

  @IsOptional()
  @IsEmail()
  billingEmail?: string;
}
