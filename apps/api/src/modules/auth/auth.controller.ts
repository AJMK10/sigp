import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DB } from '../../db/client';
import { entities, orgUnits, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Public } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { parse, z } from '../../common/validation';
import { ROLE_LABELS, ROLE_PERMISSIONS, Role } from '../../common/permissions';

@Controller('auth')
export class AuthController {
  constructor(@InjectDb() private readonly db: DB, private readonly jwt: JwtService, private readonly audit: AuditService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: { ip?: string }) {
    const { email, password } = parse(z.object({ email: z.string().email('adresse e-mail invalide'), password: z.string().min(1) }), body);
    const [u] = await this.db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) {
      await this.db.transaction((tx) => this.audit.log(tx, null, 'CONNEXION_ECHEC', 'UTILISATEUR', email, { ip: req.ip }));
      throw new UnauthorizedException('Adresse e-mail ou mot de passe incorrect');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
      await this.audit.log(tx, { user: { id: u.id, entityId: u.entityId, role: u.role as Role, fullName: u.fullName, email: u.email }, ip: req.ip }, 'CONNEXION', 'UTILISATEUR', u.email);
    });
    const token = await this.jwt.signAsync({ sub: u.id });
    return { token, user: await this.profile(u.id) };
  }

  @Get('me')
  me(@CurrentCtx() ctx: Ctx) { return this.profile(ctx.user.id); }

  private async profile(id: number) {
    const [u] = await this.db.select({ id: users.id, email: users.email, fullName: users.fullName, title: users.title, role: users.role, entityId: users.entityId, orgUnit: orgUnits.name })
      .from(users).leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId)).where(eq(users.id, id));
    const [ent] = await this.db.select().from(entities).where(eq(entities.id, u.entityId));
    return { ...u, roleLabel: ROLE_LABELS[u.role as Role], permissions: ROLE_PERMISSIONS[u.role as Role], entity: { code: ent.code, name: ent.name } };
  }
}
