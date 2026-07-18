export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, code = 'BAD_REQUEST') => new AppError(400, code, msg);
export const unauthorized = (msg = 'Authentication required', code = 'UNAUTHORIZED') => new AppError(401, code, msg);
export const forbidden = (msg = 'Insufficient permissions', code = 'FORBIDDEN') => new AppError(403, code, msg);
export const notFound = (msg = 'Not found', code = 'NOT_FOUND') => new AppError(404, code, msg);
export const conflict = (msg: string, code = 'CONFLICT') => new AppError(409, code, msg);
export const tooMany = (msg = 'Too many requests', code = 'RATE_LIMITED') => new AppError(429, code, msg);
