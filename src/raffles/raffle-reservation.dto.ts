import {
  Allow,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateRaffleReservationDto {
  // Number validation is performed by the domain service so every invalid
  // shape (including strings, decimals and duplicates) uses the stable code.
  @Allow()
  numbers!: unknown;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  buyerName!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  buyerEmail!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[0-9 +()\-]{6,30}$/)
  buyerPhone!: string;
}
