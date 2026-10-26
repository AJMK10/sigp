import { BadRequestException, Injectable } from '@nestjs/common';
import { Tx } from '../../db/client';
import { journalBatches, journalLines } from '../../db/schema';
import { NumberingService } from '../../common/numbering.service';
import { AuditService } from '../../common/audit.service';
import type { Ctx } from '../../common/context';

export interface JLine { account: string; label: string; debit?: number; credit?: number }

/** Écritures comptables générées par les pièces du patrimoine, à transmettre à l'ERP. */
@Injectable()
export class JournalService {
  constructor(private readonly numbering: NumberingService, private readonly audit: AuditService) {}

  async createBatch(tx: Tx, ctx: Ctx, b: { originType: string; originRef: string; label: string; date: string; lines: JLine[] }) {
    const lines = b.lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
    const d = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const c = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (d !== c) throw new BadRequestException(`Écriture déséquilibrée (débit ${d}, crédit ${c})`);
    if (!lines.length) return null;
    const number = await this.numbering.piece(tx, ctx.user.entityId, 'ECR', new Date(b.date));
    const [batch] = await tx.insert(journalBatches).values({ entityId: ctx.user.entityId, number, originType: b.originType, originRef: b.originRef, label: b.label, date: b.date, total: d }).returning();
    await tx.insert(journalLines).values(lines.map((l) => ({ batchId: batch.id, account: l.account, label: l.label, debit: l.debit ?? 0, credit: l.credit ?? 0 })));
    await this.audit.log(tx, ctx, 'ECRITURE', 'LOT_ECRITURES', number, { origine: b.originRef, total: d });
    return batch;
  }
}

/** Regroupe des montants par compte (une ligne par compte). */
export function groupBy(lines: { account: string | null; amount: number }[], fallback: string) {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.account ?? fallback, (m.get(l.account ?? fallback) ?? 0) + l.amount);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}
