import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { SUPPORTED_BROWSERS, SUPPORTED_DEVICES } from '../../scenarios/playwright-generator';

export class CreateRunDto {
  @IsUUID() environmentId!: string;

  // Motor de Playwright. Default CHROMIUM si se omite.
  @IsOptional() @IsIn(SUPPORTED_BROWSERS) targetBrowser?: typeof SUPPORTED_BROWSERS[number];

  // Preset de dispositivo de Playwright (p. ej. "iPhone 13"). Si se omite,
  // se corre en viewport desktop.
  @IsOptional() @IsString() @Length(1, 60) @IsIn(SUPPORTED_DEVICES) targetDevice?: typeof SUPPORTED_DEVICES[number];
}
