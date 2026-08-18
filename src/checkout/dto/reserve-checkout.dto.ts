import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';
export class ReserveCheckoutItemDto { @IsUUID() variantId!: string; @IsInt() @Min(1) quantity!: number; }
export class ReserveCheckoutDto { @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReserveCheckoutItemDto) items!: ReserveCheckoutItemDto[]; }
