import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { inArray, sql, SQL } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { assets } from '../../db/schema';
import { can, Role } from '../../common/permissions';
import { z } from '../../common/validation';
import { valuesAt } from '../assets/assets.util';
import { FieldDef, SOURCES } from './sources';

export const MAX_ROWS = 50_000;
export const OPS = ['eq', 'neq', 'in', 'nin', 'contains', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notempty', 'year', 'last_days'] as const;
export const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
const key = z.string().regex(/^[a-z_]{1,40}$/);

export const definitionSchema = z.object({
  source: key,
  columns: z.array(key).min(1, 'choisissez au moins une colonne').max(30),
  filters: z.array(z.object({ field: key, op: z.enum(OPS), value: z.union([z.string(), z.number(), z.array(z.string())]).nullable().optional(), value2: z.union([z.string(), z.number()]).nullable().optional() })).max(20).default([]),
  groupBy: z.array(key).max(2).default([]),
  aggregates: z.array(z.object({ fn: z.enum(AGGS), field: key.nullable().optional() })).max(6).default([]),
  sort: z.object({ key: z.string().max(40), dir: z.enum(['asc', 'desc']) }).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ROWS).nullable().optional(),
});
export type Definition = z.infer<typeof definitionSchema>;
type Filter = Definition['filters'][number];
export interface Column { key: string; label: string; type: FieldDef['type']; options?: Record<string, string> }
export interface Result { source: string; columns: Column[]; rows: Record<string, unknown>[]; count: number; truncated: boolean; totals: Record<string, number> | null; grouped: boolean }

const AGG_LABEL: Record<string, string> = { count: 'Nombre', count_distinct: 'Nombre distinct', sum: 'Somme', avg: 'Moyenne', min: 'Minimum', max: 'Maximum' };
const isNum = (t: string) => t === 'number' || t === 'money' || t === 'percent';

export function sourceFor(source: string, role: Role) {
  const s = SOURCES[source];
  if (!s) throw new BadRequestException('Source inconnue');
  if (!s.perms.some((p) => can(role, p))) throw new ForbiddenException("Votre profil ne donne pas accès à cette source");
  return s;
}

/** Contrôle la définition au regard du catalogue : aucun champ hors liste blanche. */
export function check(def: Definition, role: Role) {
  const s = sourceFor(def.source, role);
  const field = (k: string, what: string) => { const f = s.fields[k]; if (!f) throw new BadRequestException(`${what} : champ inconnu « ${k} »`); return f; };
  def.columns.forEach((k) => field(k, 'Colonne'));
  def.groupBy.forEach((k) => field(k, 'Regroupement'));
  for (const a of def.aggregates) {
    if (a.fn === 'count') continue;
    if (!a.field) throw new BadRequestException(`${AGG_LABEL[a.fn]} : précisez le champ`);
    const f = field(a.field, 'Calcul');
    if (a.fn !== 'count_distinct' && !isNum(f.type) && !(f.type === 'date' && (a.fn === 'min' || a.fn === 'max'))) throw new BadRequestException(`${AGG_LABEL[a.fn]} impossible sur « ${f.label} »`);
  }
  for (const f of def.filters) {
    const d = field(f.field, 'Filtre');
    const needs = !['empty', 'notempty'].includes(f.op);
    if (needs && (f.value == null || f.value === '' || (Array.isArray(f.value) && !f.value.length))) throw new BadRequestException(`Filtre « ${d.label} » : valeur manquante`);
    if (f.op === 'between' && (f.value2 == null || f.value2 === '')) throw new BadRequestException(`Filtre « ${d.label} » : borne haute manquante`);
    if (['gt', 'gte', 'lt', 'lte', 'between'].includes(f.op) && !isNum(d.type) && d.type !== 'date') throw new BadRequestException(`Filtre « ${d.label} » : comparaison impossible sur un texte`);
    if ((f.op === 'year' || f.op === 'last_days') && d.type !== 'date') throw new BadRequestException(`Filtre « ${d.label} » : réservé aux dates`);
    if (isNum(d.type) && needs && !['in', 'nin'].includes(f.op) && !Number.isFinite(Number(f.value))) throw new BadRequestException(`Filtre « ${d.label} » : nombre attendu`);
  }
  if (def.groupBy.length && !def.aggregates.length) def.aggregates = [{ fn: 'count' }];
  return s;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
function asNum(d: FieldDef, v: unknown) { return d.type === 'percent' ? Number(v) / 100 : Number(v); }

/** Condition SQL d'un filtre : expression constante du catalogue, valeur en paramètre. */
function sqlFilter(d: FieldDef, f: Filter): SQL {
  const e = sql.raw(`(${d.sql})`);
  const v = isNum(d.type) && !Array.isArray(f.value) && f.value != null ? asNum(d, f.value) : f.value;
  const list = (Array.isArray(f.value) ? f.value : String(f.value ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  switch (f.op) {
    case 'eq': return sql`${e} = ${v}`;
    case 'neq': return sql`(${e} IS DISTINCT FROM ${v})`;
    case 'in': return sql`${e} IN (${sql.join(list.map((x) => sql`${isNum(d.type) ? Number(x) : x}`), sql`, `)})`;
    case 'nin': return sql`(${e} IS NULL OR ${e} NOT IN (${sql.join(list.map((x) => sql`${isNum(d.type) ? Number(x) : x}`), sql`, `)}))`;
    case 'contains': return sql`${e}::text ILIKE ${'%' + String(f.value).replace(/[%_\\]/g, (m) => '\\' + m) + '%'}`;
    case 'gt': return sql`${e} > ${v}`;
    case 'gte': return sql`${e} >= ${v}`;
    case 'lt': return sql`${e} < ${v}`;
    case 'lte': return sql`${e} <= ${v}`;
    case 'between': return sql`${e} BETWEEN ${v} AND ${isNum(d.type) ? asNum(d, f.value2) : f.value2}`;
    case 'empty': return sql`(${e} IS NULL OR ${e}::text = '')`;
    case 'notempty': return sql`(${e} IS NOT NULL AND ${e}::text <> '')`;
    case 'year': return sql`left(${e}, 4) = ${String(f.value)}`;
    case 'last_days': return sql`${e} >= ${daysAgo(Number(f.value))}`;
  }
}

/** Même condition, évaluée en mémoire pour les champs calculés (VNC, cumul, vétusté). */
function jsFilter(d: FieldDef, f: Filter) {
  const n = (x: unknown) => asNum(d, x);
  return (x: unknown) => {
    const val = x as number | null;
    switch (f.op) {
      case 'eq': return val === n(f.value);
      case 'neq': return val !== n(f.value);
      case 'gt': return val != null && val > n(f.value);
      case 'gte': return val != null && val >= n(f.value);
      case 'lt': return val != null && val < n(f.value);
      case 'lte': return val != null && val <= n(f.value);
      case 'between': return val != null && val >= n(f.value) && val <= n(f.value2);
      case 'empty': return val == null;
      case 'notempty': return val != null;
      default: return true;
    }
  };
}

export async function execute(db: DB, entityId: number, role: Role, input: Definition, opts: { maxDisplay?: number } = {}): Promise<Result> {
  const def = { ...input, aggregates: [...input.aggregates] };
  const s = check(def, role);
  const needed = new Set<string>([...def.columns, ...def.groupBy, ...def.filters.map((f) => f.field), ...def.aggregates.map((a) => a.field).filter((x): x is string => !!x)]);
  if (def.sort?.key && s.fields[def.sort.key]) needed.add(def.sort.key);
  const sqlFields = [...needed].filter((k) => s.fields[k].sql);
  const computed = [...needed].filter((k) => s.fields[k].computed);
  const select = sqlFields.map((k) => sql.raw(`(${s.fields[k].sql}) AS "${k}"`));
  if (computed.length) select.push(sql.raw(`${s.assetId} AS "__asset"`));
  if (!select.length) select.push(sql.raw('1 AS "__one"'));
  const where = [sql`${sql.raw(s.entity)} = ${entityId}`, ...def.filters.filter((f) => s.fields[f.field].sql).map((f) => sqlFilter(s.fields[f.field], f))];
  const q = sql`SELECT ${sql.join(select, sql`, `)} FROM ${sql.raw(s.from)} WHERE ${sql.join(where, sql` AND `)} LIMIT ${MAX_ROWS + 1}`;
  const res = await db.execute(q);
  let rows = res.rows as Record<string, unknown>[];
  const truncatedSource = rows.length > MAX_ROWS;
  if (truncatedSource) rows = rows.slice(0, MAX_ROWS);
  // Numériques : bigint et numeric arrivent en texte depuis PostgreSQL.
  for (const k of sqlFields) if (isNum(s.fields[k].type)) for (const r of rows) if (r[k] != null) r[k] = Number(r[k]);
  if (computed.length) {
    const ids = rows.map((r) => Number(r.__asset));
    const byId = new Map<number, ReturnType<typeof valuesAt>>();
    for (let i = 0; i < ids.length; i += 2000) {
      const chunk = await db.select().from(assets).where(inArray(assets.id, ids.slice(i, i + 2000)));
      for (const a of chunk) byId.set(a.id, valuesAt(a));
    }
    for (const r of rows) {
      const v = byId.get(Number(r.__asset));
      for (const k of computed) r[k] = v ? (s.fields[k].computed === 'cumulative' ? v.cumulative : s.fields[k].computed === 'nbv' ? v.nbv : v.wear) : null;
      delete r.__asset;
    }
    for (const f of def.filters.filter((x) => s.fields[x.field].computed)) { const t = jsFilter(s.fields[f.field], f); rows = rows.filter((r) => t(r[f.field])); }
  }
  const count = rows.length;
  let columns: Column[];
  let out: Record<string, unknown>[];
  let totals: Record<string, number> | null = null;
  if (def.groupBy.length) {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) { const k = JSON.stringify(def.groupBy.map((g) => r[g] ?? null)); const arr = groups.get(k); if (arr) arr.push(r); else groups.set(k, [r]); }
    const aggCols = def.aggregates.map((a, i) => {
      const f = a.field ? s.fields[a.field] : null;
      const type: FieldDef['type'] = a.fn === 'count' || a.fn === 'count_distinct' ? 'number' : f!.type === 'date' ? 'date' : f!.type;
      return { key: `agg_${i}`, label: a.fn === 'count' && !f ? 'Nombre' : `${AGG_LABEL[a.fn]} · ${f!.label}`, type, a };
    });
    columns = [...def.groupBy.map((g) => ({ key: g, label: s.fields[g].label, type: s.fields[g].type, options: s.fields[g].options })), ...aggCols.map(({ key, label, type }) => ({ key, label, type }))];
    out = [...groups.values()].map((g) => {
      const o: Record<string, unknown> = {};
      def.groupBy.forEach((k) => (o[k] = g[0][k] ?? null));
      for (const c of aggCols) {
        const vals = c.a.field ? g.map((r) => r[c.a.field!]).filter((x) => x != null && x !== '') : g;
        const nums = vals.map(Number).filter(Number.isFinite);
        o[c.key] = c.a.fn === 'count' ? vals.length : c.a.fn === 'count_distinct' ? new Set(vals.map(String)).size
          : c.type === 'date' ? (vals.length ? (vals as string[]).sort()[c.a.fn === 'min' ? 0 : vals.length - 1] : null)
          : !nums.length ? null : c.a.fn === 'sum' ? nums.reduce((x, y) => x + y, 0) : c.a.fn === 'avg' ? Math.round((nums.reduce((x, y) => x + y, 0) / nums.length) * (c.type === 'money' ? 1 : 100)) / (c.type === 'money' ? 1 : 100)
          : c.a.fn === 'min' ? Math.min(...nums) : Math.max(...nums);
      }
      return o;
    });
    totals = Object.fromEntries(aggCols.filter((c) => ['count', 'sum'].includes(c.a.fn) && c.type !== 'percent').map((c) => [c.key, out.reduce((x, r) => x + Number(r[c.key] ?? 0), 0)]));
    if (!def.sort) def.sort = { key: aggCols[0].key, dir: 'desc' };
  } else {
    columns = def.columns.map((k) => ({ key: k, label: s.fields[k].label, type: s.fields[k].type, options: s.fields[k].options }));
    out = rows.map((r) => Object.fromEntries(def.columns.map((k) => [k, r[k] ?? null])));
    if (def.sort && !def.columns.includes(def.sort.key) && s.fields[def.sort.key]) out.forEach((o, i) => (o.__sort = rows[i][def.sort!.key]));
    totals = Object.fromEntries(columns.filter((c) => c.type === 'money' || (c.type === 'number' && !/annee|duree|compteur/.test(c.key))).map((c) => [c.key, out.reduce((x, r) => x + Number(r[c.key] ?? 0), 0)]));
  }
  if (def.sort) {
    const k = out.some((o) => '__sort' in o) ? '__sort' : def.sort.key;
    const dir = def.sort.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * dir;
    });
    out.forEach((o) => delete o.__sort);
  }
  if (def.limit) out = out.slice(0, def.limit);
  const max = opts.maxDisplay ?? MAX_ROWS;
  return { source: def.source, columns, rows: out.slice(0, max), count, truncated: truncatedSource || out.length > max, totals: totals && Object.keys(totals).length ? totals : null, grouped: def.groupBy.length > 0 };
}

/** Valeur lisible d'une cellule (exports). */
export function display(c: Column, v: unknown): string | number | null {
  if (v == null || v === '') return null;
  if (c.type === 'enum') return c.options?.[String(v)] ?? String(v);
  if (c.type === 'date') { const s = String(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s; }
  if (c.type === 'percent') return Math.round(Number(v) * 1000) / 10;
  if (c.type === 'money') return Math.round(Number(v));
  if (c.type === 'number') return Number(v);
  return String(v);
}
