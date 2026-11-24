import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsString, IsUUID, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { LoadStageDto } from '../../load/dto/create-load-test.dto';

export class QualityConfigurationDto {
  @IsUUID() environmentId!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString() @Length(1, 2048) url?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt() @Min(5) @Max(1440) intervalMinutes?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt() @Min(1000) @Max(60000) timeoutMs?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean() active?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['GET', 'HEAD']) method?: 'GET' | 'HEAD';

  @ValidateIf((_, value) => value !== undefined)
  @IsInt() @Min(200) @Max(599) minStatus?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt() @Min(200) @Max(599) maxStatus?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => LoadStageDto)
  stages?: LoadStageDto[];
}
