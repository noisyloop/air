import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Parse unknown input with a zod schema; throws a 400 AppError with details. */
export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw badRequest(`Validation failed — ${detail}`, 'VALIDATION_ERROR');
  }
  return result.data;
}
