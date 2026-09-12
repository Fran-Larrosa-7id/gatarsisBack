import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayMaxSize,
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
  Max,
  Min,
  MinLength,
  ValidateNested,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { FulfillmentMethod } from "../../orders/entities/order-fulfillment.entity";
import { MAX_CHECKOUT_LINES, MAX_QUANTITY_PER_ITEM, MAX_TOTAL_QUANTITY } from "../checkout-limits";

@ValidatorConstraint({ name: "checkoutTotalQuantity", async: false })
class CheckoutTotalQuantityConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (!Array.isArray(value)) return false;
    return value.reduce((total, item) => total + (typeof item === "object" && item && "quantity" in item && typeof (item as { quantity?: unknown }).quantity === "number" ? (item as { quantity: number }).quantity : 0), 0) <= MAX_TOTAL_QUANTITY;
  }
  defaultMessage(_args: ValidationArguments) { return "CHECKOUT_TOTAL_QUANTITY_EXCEEDED"; }
}

export class ReserveCheckoutItemDto {
  @IsUUID() variantId!: string;
  @IsInt() @Min(1) @Max(MAX_QUANTITY_PER_ITEM, { message: "CHECKOUT_QUANTITY_EXCEEDED" }) quantity!: number;
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
  @ArrayMaxSize(MAX_CHECKOUT_LINES, { message: "CHECKOUT_TOO_MANY_LINES" })
  @Validate(CheckoutTotalQuantityConstraint, { message: "CHECKOUT_TOTAL_QUANTITY_EXCEEDED" })
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
