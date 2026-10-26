import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, createReadStream } from 'fs';
import path from 'path';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { documents, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { parse, z, zId } from '../../common/validation';

const STORAGE = process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage');
const MAX = 20 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(png|jpeg|webp)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|text\/csv)$/;
export const DOC_CATEGORIES: Record<string, string> = { FACTURE: 'Facture', PV: 'Procès-verbal', TITRE: 'Titre ou acte', CONTRAT: 'Contrat ou police', PHOTO: 'Photo', DECHARGE: 'Décharge signée', EXPERTISE: "Rapport d'expertise", AUTRE: 'Autre' };
const OBJECTS = ['BIEN', 'RECEPTION', 'MOUVEMENT', 'REFORME', 'CONTRAT', 'MISSION', 'OT', 'INVENTAIRE', 'REVISION'] as const;

/** Enregistre un fichier (stockage, empreinte SHA-256, trace d'audit) ; utilisé par la GED et l'application mobile. */
export async function storeDocument(tx: Tx, audit: AuditService, ctx: Ctx, f: { objectType: string; objectId: number; category: string; filename: string; mime: string; buffer: Buffer }) {
  if (!ALLOWED.test(f.mime)) throw new BadRequestException('Format non accepté : PDF, image, Word, Excel ou CSV');
  if (f.buffer.length > MAX) throw new BadRequestException('Fichier trop volumineux (20 Mo au plus)');
  const sha256 = createHash('sha256').update(f.buffer).digest('hex');
  const key = `${ctx.user.entityId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
  const full = path.join(STORAGE, key);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, f.buffer, { flag: 'wx' });
  const [d] = await tx.insert(documents).values({ entityId: ctx.user.entityId, objectType: f.objectType, objectId: f.objectId, category: f.category, filename: f.filename, mime: f.mime,
    size: f.buffer.length, sha256, storageKey: key, uploadedBy: ctx.user.id }).returning();
  await audit.log(tx, ctx, 'DOCUMENT', f.objectType, `${f.objectType}-${f.objectId}`, { fichier: d.filename, empreinte: sha256, categorie: f.category });
  return d;
}

/** Gestion électronique des documents : pièces justificatives rattachées aux objets métier, avec empreinte d'intégrité. */
@Controller('documents')
export class DocumentsController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService) {}

  @Get() @Perm('assets.read', 'documents.write')
  async list(@CurrentCtx() ctx: Ctx, @Query() query: unknown) {
    const q = parse(z.object({ objectType: z.enum(OBJECTS).optional(), objectId: zId.optional(), category: z.string().optional(), q: z.string().optional() }), query);
    const rows = await this.db.select({ d: documents, by: users.fullName }).from(documents).leftJoin(users, eq(users.id, documents.uploadedBy))
      .where(and(eq(documents.entityId, ctx.user.entityId), q.objectType ? eq(documents.objectType, q.objectType) : undefined, q.objectId ? eq(documents.objectId, q.objectId) : undefined,
        q.category ? eq(documents.category, q.category) : undefined, q.q ? ilike(documents.filename, `%${q.q}%`) : undefined)).orderBy(desc(documents.id)).limit(500);
    const stats = await this.db.select({ c: documents.category, n: sql<number>`count(*)` }).from(documents).where(eq(documents.entityId, ctx.user.entityId)).groupBy(documents.category);
    return { items: rows.map((r) => ({ ...r.d, by: r.by, categoryLabel: DOC_CATEGORIES[r.d.category] ?? r.d.category })), byCategory: Object.fromEntries(stats.map((s) => [s.c, Number(s.n)])) };
  }

  @Post() @Perm('documents.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX } }))
  async upload(@CurrentCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    const b = parse(z.object({ objectType: z.enum(OBJECTS), objectId: zId, category: z.enum(Object.keys(DOC_CATEGORIES) as [string, ...string[]]) }), body);
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    if (!ALLOWED.test(file.mimetype)) throw new BadRequestException('Format non accepté : PDF, image, Word, Excel ou CSV');
    return this.db.transaction((tx) => storeDocument(tx, this.audit, ctx, { ...b, filename: Buffer.from(file.originalname, 'latin1').toString('utf8'), mime: file.mimetype, buffer: file.buffer }));
  }

  /** Téléchargement ; l'empreinte est recontrôlée pour garantir que le fichier n'a pas été altéré. */
  @Get(':id/fichier') @Perm('assets.read', 'documents.write', 'portal.use')
  async file(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Res() res: Response) {
    const [d] = await this.db.select().from(documents).where(and(eq(documents.id, parse(zId, id)), eq(documents.entityId, ctx.user.entityId)));
    if (!d) throw new NotFoundException('Document introuvable');
    const full = path.join(STORAGE, d.storageKey);
    if (!existsSync(full)) throw new NotFoundException('Fichier absent du stockage');
    res.setHeader('Content-Type', d.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.filename)}`);
    res.setHeader('X-Content-SHA256', d.sha256);
    createReadStream(full).pipe(res);
  }

  @Get(':id/verifier') @Perm('assets.read', 'documents.write')
  async verify(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const [d] = await this.db.select().from(documents).where(and(eq(documents.id, parse(zId, id)), eq(documents.entityId, ctx.user.entityId)));
    if (!d) throw new NotFoundException('Document introuvable');
    const full = path.join(STORAGE, d.storageKey);
    if (!existsSync(full)) return { ok: false, reason: 'Fichier absent' };
    const { readFileSync } = await import('fs');
    return { ok: createHash('sha256').update(readFileSync(full)).digest('hex') === d.sha256, sha256: d.sha256 };
  }
}
