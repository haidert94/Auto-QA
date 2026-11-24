import { IsISO8601, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

// DTO del endpoint PUT /projects/:id/environments/:environmentId/storage-state.
// La validación profunda del blob (shape de cookies/origins, tamaños, campos
// permitidos) la hace parseStorageState — aquí solo filtramos la forma mínima
// para que NestJS no lo rechace antes de llegar al servicio.
export class SetStorageStateDto {
  @IsObject({ message: 'storageState debe ser un objeto JSON' })
  storageState!: unknown;

  // Nota libre del QA para identificar la sesión sin leer el blob.
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  // Si se omite, no hay TTL. Recomendado ponerlo igual para forzar rotación.
  // El servicio rechaza fechas pasadas.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  expiresAt?: string | null;
}
