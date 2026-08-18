import { Equals, IsString, MinLength } from "class-validator";
export class CreateRefundDto {
  @IsString() @MinLength(1) reason!: string;
  @Equals("REEMBOLSAR") confirmation!: "REEMBOLSAR";
}
