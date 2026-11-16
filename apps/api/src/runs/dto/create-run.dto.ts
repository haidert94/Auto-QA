import { IsUUID } from 'class-validator';

export class CreateRunDto {
  @IsUUID() environmentId!: string;
}
