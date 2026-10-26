import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role, Permission } from './permissions';

export interface AuthUser { id: number; entityId: number; role: Role; fullName: string; email: string }
export interface Ctx { user: AuthUser; ip?: string }

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const PERMS = 'perms';
/** Droit requis (l'un des droits listés suffit). */
export const Perm = (...p: Permission[]) => SetMetadata(PERMS, p);

export const CurrentCtx = createParamDecorator((_: unknown, ctx: ExecutionContext): Ctx => {
  const req = ctx.switchToHttp().getRequest();
  return { user: req.user, ip: req.ip };
});
