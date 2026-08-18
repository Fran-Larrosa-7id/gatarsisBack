import { IsEmail, IsString, MinLength } from "class-validator";

export class AdminLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(14) password!: string;
}
export class AdminRefreshDto {
  @IsString() @MinLength(32) refreshToken!: string;
}
