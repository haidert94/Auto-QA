import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
import { ALL_TEST_TYPES, type AutomationTestType } from '../test-types';

export class SelectTestsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(ALL_TEST_TYPES.length) @ArrayUnique() @IsIn(ALL_TEST_TYPES, { each: true })
  types!: AutomationTestType[];
}
