import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { InventoryMovementType } from '../inventory/entities/inventory-movement.entity';
const bool = ({ value }: { value: unknown }) => value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;
export class InventoryListDto { @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number; @IsOptional() @IsString() search?: string; @IsOptional() @Transform(bool) active?: boolean; @IsOptional() @Transform(bool) lowStock?: boolean; @IsOptional() @Transform(bool) outOfStock?: boolean; @IsOptional() @IsString() sort?: string; }
export class RestockDto { @Type(() => Number) @IsInt() @Min(1) quantity!: number; @IsString() @MinLength(1) reason!: string; }
export class AdjustDto { @Type(() => Number) @IsInt() @Min(0) stockOnHand!: number; @IsString() @MinLength(1) reason!: string; }
export class MovementListDto { @IsOptional() @IsEnum(InventoryMovementType) type?: InventoryMovementType; @IsOptional() @IsDateString() dateFrom?: string; @IsOptional() @IsDateString() dateTo?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number; }
