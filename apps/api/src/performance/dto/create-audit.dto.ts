import { IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAuditDto {
  @IsUUID() environmentId!: string;
  @IsString() @MaxLength(2048) url!: string;
}
