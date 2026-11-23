import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { ALL_TEST_TYPES, type AutomationTestType } from '../test-types';

export class AutomationDocumentDto {
  @IsString() @Length(1, 255) filename!: string;
  // Base64 del archivo. El servicio lo decodifica y valida tamaño (<5 MB por doc).
  @IsString() @MaxLength(7_500_000) base64!: string;
}

export class CreateAutomationDto {
  @IsString() @Length(1, 2048) url!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @Length(1, 200) ownerLabel?: string;
  // Credenciales opcionales: por ahora NO se persisten ni se usan; se
  // documenta como feature futura (vault con cifrado por org).
  @IsOptional() @IsString() @Length(0, 120) credentialsHint?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AutomationDocumentDto)
  documents?: AutomationDocumentDto[];
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(ALL_TEST_TYPES.length) @ArrayUnique() @IsIn(ALL_TEST_TYPES, { each: true })
  documentTestTypes?: AutomationTestType[];
}
