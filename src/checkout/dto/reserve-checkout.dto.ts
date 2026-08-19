import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { FulfillmentMethod } from "../../orders/entities/order-fulfillment.entity";
export class ReserveCheckoutItemDto {
  @IsUUID() variantId!: string;
  @IsInt() @Min(1) quantity!: number;
}
export class CustomerDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Matches(/^[0-9 +()\-]{6,30}$/)
  phone!: string;
}
export class FulfillmentDto {
  @IsEnum(FulfillmentMethod) method!: FulfillmentMethod;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ReserveCheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReserveCheckoutItemDto)
  items!: ReserveCheckoutItemDto[];
  @IsDefined()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer!: CustomerDto;
  @IsDefined()
  @ValidateNested()
  @Type(() => FulfillmentDto)
  fulfillment!: FulfillmentDto;
}
