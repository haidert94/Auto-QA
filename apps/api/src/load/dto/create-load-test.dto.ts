import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class LoadStageDto {
  // Formato de k6: "30s", "2m", "1h". Validado también en el generador.
  @IsString() @Matches(/^\d+[smh]$/) duration!: string;
  @IsInt() @Min(0) @Max(1000) target!: number;
}

export class CreateLoadTestDto {
  @IsUUID() environmentId!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsString() @MaxLength(2048) url!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => LoadStageDto)
  stages!: LoadStageDto[];
}
