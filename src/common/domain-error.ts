import { HttpException, HttpStatus } from "@nestjs/common";

export class DomainError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    status = HttpStatus.CONFLICT,
  ) {
    super({ code, message, ...(details ? { details } : {}) }, status);
  }
}
