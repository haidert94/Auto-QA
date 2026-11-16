import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class ExplorationLimitsDto {
  @IsOptional() @IsInt() @Min(1) @Max(200) maxPages?: number;
  @IsOptional() @IsInt() @Min(5) @Max(600) perNavigationTimeoutSeconds?: number;
  @IsOptional() @IsInt() @Min(30) @Max(3600) totalBudgetSeconds?: number;
  @IsOptional() @IsInt() @Min(1024) @Max(50_000_000) maxResponseBytes?: number;
}

export class CreateExplorationDto {
  @IsUUID() environmentId!: string;
  @IsString() @MaxLength(2048) startUrl!: string;
  @IsOptional() @ValidateNested() @Type(() => ExplorationLimitsDto) limits?: ExplorationLimitsDto;
  // Omite el caché de reutilización reciente y crea una nueva exploración.
  @IsOptional() @IsBoolean() force?: boolean;
}
