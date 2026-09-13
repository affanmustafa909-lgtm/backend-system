import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
} from "@nestjs/common";
import { ZodError } from "zod";

/** Map unhandled ZodError from `.parse()` to HTTP 400 instead of 500. */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();
    const message =
      exception.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") ||
      "Validation failed";
    res.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: "Bad Request",
      errors: exception.issues,
    });
  }
}

export function zodBadRequest(error: ZodError): BadRequestException {
  const message =
    error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") ||
    "Validation failed";
  return new BadRequestException({ message, errors: error.issues });
}
