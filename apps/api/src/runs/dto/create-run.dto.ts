import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { SUPPORTED_BROWSERS, SUPPORTED_DEVICES, SUPPORTED_PROVIDERS } from '../../scenarios/playwright-generator';

export class CreateRunDto {
  @IsUUID() environmentId!: string;

  @IsOptional() @IsUUID() automationId?: string | null;

  @IsOptional() @IsDateString() writeAuthorizationAt?: string;

  // Motor de Playwright. Default CHROMIUM si se omite.
  @IsOptional() @IsIn(SUPPORTED_BROWSERS) targetBrowser?: typeof SUPPORTED_BROWSERS[number];

  // Preset de dispositivo de Playwright (p. ej. "iPhone 13"). Si se omite,
  // se corre en viewport desktop.
  @IsOptional() @IsString() @Length(1, 60) @IsIn(SUPPORTED_DEVICES) targetDevice?: typeof SUPPORTED_DEVICES[number];

  // Dónde se ejecuta. LOCAL = worker propio con Playwright instalado.
  // BROWSERSTACK = se conecta a la nube de BrowserStack vía CDP (requiere
  // AUTOQA_BROWSERSTACK_USERNAME y AUTOQA_BROWSERSTACK_ACCESS_KEY en el
  // worker). Default LOCAL si se omite.
  @IsOptional() @IsIn(SUPPORTED_PROVIDERS) targetProvider?: typeof SUPPORTED_PROVIDERS[number];
}
