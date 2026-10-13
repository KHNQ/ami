export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  badRequest: (message, code = "bad_request", details) => new AppError(400, code, message, details),
  unauthorized: (message = "Unauthorized", code = "unauthorized") => new AppError(401, code, message),
  forbidden: (message = "Forbidden", code = "forbidden") => new AppError(403, code, message),
  notFound: (message = "Not found", code = "not_found") => new AppError(404, code, message),
  conflict: (message, code = "conflict", details) => new AppError(409, code, message, details),
  unprocessable: (message, code = "unprocessable", details) => new AppError(422, code, message, details),
  tooManyRequests: (message = "Too many requests, please try again later", code = "rate_limited") =>
    new AppError(429, code, message),
  internal: (message = "Internal server error", code = "internal") => new AppError(500, code, message),
};
