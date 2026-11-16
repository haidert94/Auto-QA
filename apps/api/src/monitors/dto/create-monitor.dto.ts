import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateMonitorDto {
  @IsUUID() environmentId!: string;
  @IsString() @Length(1, 120) @Matches(/^[^\u0000-\u001f]+$/) name!: string;
  @IsString() @MaxLength(2048) url!: string;
  @IsOptional() @IsInt() @Min(5) @Max(1440) intervalMinutes?: number;
  @IsOptional() @IsInt() @Min(1000) @Max(60000) timeoutMs?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsEmail({}, { each: true }) notifyEmails?: string[];
}

export class UpdateMonitorDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(1440) intervalMinutes?: number;
  @IsOptional() @IsInt() @Min(1000) @Max(60000) timeoutMs?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsEmail({}, { each: true }) notifyEmails?: string[];
}
