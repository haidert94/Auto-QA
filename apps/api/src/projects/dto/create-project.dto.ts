import { applyDecorators } from '@nestjs/common';
import { AccessMode, EnvironmentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsString,
  IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';

const optional = () => ValidateIf((_, value) => value !== undefined);

function text(maximum: number, each = false) {
  return applyDecorators(
    IsString({ each }),
    MaxLength(maximum, { each }),
    Matches(/^(?=[^\0]*\S)[^\0]+$/u, { each, message: '$property debe contener texto válido' }),
  );
}

class ScopePathDto {
  @text(253)
  host!: string;

  @text(1024)
  path!: string;
}

class EnvironmentCredentialsDto {
  @text(320)
  user!: string;

  @text(512)
  password!: string;
}

class TestDataDto {
  @optional()
  @text(1000)
  syntheticData?: string;

  @optional()
  @text(1000)
  seeds?: string;

  @optional()
  @text(1000)
  cleanupStrategy?: string;

  @optional()
  @IsArray()
  @ArrayMaxSize(30)
  @text(160, true)
  integrations?: string[];
}

class EnvironmentDto {
  @optional()
  @IsUUID()
  id?: string;

  @optional()
  @IsEnum(EnvironmentType)
  type?: EnvironmentType;

  @optional()
  @text(120)
  version?: string;

  @optional()
  @text(2048)
  baseUrl?: string;

  @optional()
  @IsEnum(AccessMode)
  accessMode?: AccessMode;

  @optional()
  @IsBoolean()
  authorizationConfirmed?: boolean;

  @optional()
  @IsBoolean()
  readOnly?: boolean;

  @optional()
  @IsArray()
  @ArrayMaxSize(30)
  @text(253, true)
  allowedHosts?: string[];

  @optional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ScopePathDto)
  allowedPaths?: ScopePathDto[];

  @optional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ScopePathDto)
  excludedPaths?: ScopePathDto[];

  @optional()
  @IsArray()
  @ArrayMaxSize(50)
  @text(160, true)
  prohibitedActions?: string[];

  @optional()
  @IsObject()
  @ValidateNested()
  @Type(() => TestDataDto)
  testData?: TestDataDto;

  @optional()
  @IsObject()
  @ValidateNested()
  @Type(() => EnvironmentCredentialsDto)
  credentials?: EnvironmentCredentialsDto | null;
}

class PermissionDto {
  @text(160)
  resource!: string;

  @text(160)
  action!: string;

  @IsBoolean()
  allowed!: boolean;
}

class RoleDto {
  @text(120)
  name!: string;

  @optional()
  @text(500)
  description?: string;

  @optional()
  @IsString()
  @Matches(/^vault:[a-z0-9][a-z0-9._/-]{0,179}$/i, {
    message: 'secretReference debe ser un identificador de bóveda con prefijo vault:',
  })
  secretReference?: string;

  @optional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => PermissionDto)
  permissions?: PermissionDto[];
}

const positiveLimit = () => applyDecorators(IsInt(), Min(1), Max(2147483647));

class ExecutionSettingsDto {
  @optional()
  @IsIn(['CHROMIUM', 'FIREFOX', 'WEBKIT'])
  browser?: string;

  @optional()
  @text(160)
  frequency?: string;

  @optional()
  @positiveLimit()
  maxPages?: number;

  @optional()
  @positiveLimit()
  maxDurationSeconds?: number;

  @optional()
  @positiveLimit()
  maxConcurrency?: number;

  @optional()
  @positiveLimit()
  requestsPerMinute?: number;

  @optional()
  @text(500)
  notifications?: string;
}

class ProjectOnboardingDto {
  @text(120)
  name!: string;

  @optional()
  @text(1000)
  description?: string;

  @optional()
  @text(120)
  ownerLabel?: string;

  @optional()
  @IsIn(['DRAFT', 'READY'])
  status?: 'DRAFT' | 'READY';

  @optional()
  @IsArray()
  @ArrayMaxSize(50)
  @text(160, true)
  priorityModules?: string[];

  @optional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => EnvironmentDto)
  environments?: EnvironmentDto[];

  @optional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => RoleDto)
  roles?: RoleDto[];

  @optional()
  @IsObject()
  @ValidateNested()
  @Type(() => ExecutionSettingsDto)
  executionSettings?: ExecutionSettingsDto;
}

export class CreateProjectDto extends ProjectOnboardingDto {
  @optional()
  @text(2048)
  baseUrl?: string;

  @optional()
  @IsEnum(EnvironmentType)
  environment?: EnvironmentType;

  @optional()
  @IsBoolean()
  authorizationConfirmed?: boolean;

  @optional()
  @IsBoolean()
  readOnly?: boolean;
}

export class UpdateProjectDto extends ProjectOnboardingDto {
  @IsInt()
  @Min(0)
  @Max(2147483647)
  revision!: number;
}
