import { BadRequestException } from '@nestjs/common';
import { z, ZodTypeAny } from 'zod';

/** Valide un corps de requête ; renvoie une erreur 400 lisible en français. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'requête'} : ${i.message}`).join(' ; ');
    throw new BadRequestException(msg);
  }
  return r.data;
}
export const zId = z.coerce.number().int().positive();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue au format AAAA-MM-JJ');
export const zPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'période attendue au format AAAA-MM');
export const zMoney = z.coerce.number().int().nonnegative();
export { z };
