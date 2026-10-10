import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/** `?archived=true` lists all rows including archived ones. */
export class ListArchivedQueryDto {
  @IsOptional()
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    [true, 'true'].includes(obj.archived as string | boolean),
  )
  @IsBoolean()
  archived?: boolean;
}
