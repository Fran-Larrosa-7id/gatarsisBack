import { Transform, Type } from "class-transformer";
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateRaffleDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  prizeName!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2_048)
  imageUrl?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  priceInCents!: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  drawAt?: string | null;
}

export class UpdateRaffleDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  prizeName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2_048)
  imageUrl?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  priceInCents?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  drawAt?: string | null;
}

export class RaffleListDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
