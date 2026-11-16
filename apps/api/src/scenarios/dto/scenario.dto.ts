import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

// Formato abierto a propósito: la fase 6.2 (generación Playwright) añadirá
// un paso posterior para traducir estos campos libres a aserciones concretas.
// Aquí solo exigimos que el autor describa qué hace y, opcionalmente, qué
// datos usa y qué espera.
export class ScenarioStepDto {
  @IsInt() @Min(1) ordinal!: number;
  @IsString() @MaxLength(1000) action!: string;
  @IsOptional() @IsString() @MaxLength(1000) data?: string;
  @IsOptional() @IsString() @MaxLength(1000) expected?: string;
}

export class CreateScenarioDto {
  @IsString() @MaxLength(300) title!: string;
  @IsOptional() @IsUUID() requirementId?: string;
  @IsOptional() @IsString() @MaxLength(2000) expectedResult?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ScenarioStepDto)
  steps!: ScenarioStepDto[];
}

export class UpdateScenarioDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsUUID() requirementId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) expectedResult?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ScenarioStepDto)
  steps?: ScenarioStepDto[];
}
