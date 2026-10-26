import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { DB } from '../../db/client';
import { users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { IS_PUBLIC, PERMS } from '../../common/context';
import { can, Permission, Role } from '../../common/permissions';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, @InjectDb() private readonly db: DB) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query?.token as string | undefined); // ?token= pour les téléchargements
    if (!token) throw new UnauthorizedException('Authentification requise');
    let payload: { sub: number };
    try { payload = await this.jwt.verifyAsync(token); } catch { throw new UnauthorizedException('Session expirée, reconnectez-vous'); }
    const [u] = await this.db.select().from(users).where(eq(users.id, payload.sub));
    if (!u || !u.active) throw new UnauthorizedException('Compte désactivé');
    req.user = { id: u.id, entityId: u.entityId, role: u.role as Role, fullName: u.fullName, email: u.email };
    const perms = this.reflector.getAllAndOverride<Permission[]>(PERMS, targets);
    if (perms?.length && !perms.some((p) => can(u.role as Role, p))) throw new ForbiddenException("Votre profil ne permet pas cette action");
    return true;
  }
}
