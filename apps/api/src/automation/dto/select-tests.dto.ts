import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn } from 'class-validator';
import { ALL_TEST_TYPES, type AutomationTestType } from '../test-types';

export class SelectTestsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsIn(ALL_TEST_TYPES, { each: true })
  types!: AutomationTestType[];
}
