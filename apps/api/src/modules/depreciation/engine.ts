/**
 * Moteur d'amortissement (pur, sans base de données).
 * - Linéaire : prorata temporis au jour près, convention 30/360 (année de 360 jours, mois de 30 jours).
 * - Dégressif fiscal : coefficients 1,5 (3–4 ans), 2 (5–6 ans), 2,5 (> 6 ans), prorata en mois
 *   pour le premier exercice, bascule en linéaire quand l'annuité linéaire sur la durée restante devient supérieure.
 * Le cumul à une date est arrondi au franc ; la dotation d'une période = cumul(fin) − cumul(fin de la période précédente),
 * ce qui garantit que la somme des dotations égale toujours le cumul.
 */
export type Method = 'LINEAIRE' | 'DEGRESSIF' | 'NON_AMORTISSABLE';
export interface DeprInput {
  base: number;           // valeur d'origine (FCFA)
  residual?: number;      // valeur résiduelle
  method: Method;
  years: number;          // durée d'utilité en années
  inServiceDate: string | null; // AAAA-MM-JJ
  /** Révision de durée (changement d'estimation, prospectif) : à partir de `date`, le solde amortissable
   *  restant à cette date est étalé linéairement sur la durée restante ; avant, la durée initiale s'applique. */
  revision?: { date: string; cumulative: number; previousYears: number } | null;
  /** Dépréciation constatée : le cumul des amortissements ne peut dépasser base − résiduelle − dépréciation. */
  impairment?: number;
}
export interface ScheduleLine { year: number; dotation: number; cumulative: number; nbv: number }

const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };

/** Jours entre deux dates, convention 30/360 européenne, bornes incluses. */
export function days360Inclusive(from: string, to: string): number {
  const a = parse(from), b = parse(to);
  const d1 = Math.min(a.d, 30), d2 = Math.min(b.d, 30);
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1) + 1;
}

export function degressiveCoefficient(years: number): number {
  if (years <= 2) return 1;
  if (years <= 4) return 1.5;
  if (years <= 6) return 2;
  return 2.5;
}

function degressiveYears(input: DeprInput): { year: number; dotation: number; firstMonths: number }[] {
  const { y, m } = parse(input.inServiceDate!);
  const rate = degressiveCoefficient(input.years) / input.years;
  const firstMonths = 12 - m + 1;
  const out: { year: number; dotation: number; firstMonths: number }[] = [];
  let nbv = input.base;
  let elapsedYears = 0;
  let year = y;
  while (nbv > 0.5 && out.length < input.years + 2) {
    const fraction = year === y ? firstMonths / 12 : 1;
    const remaining = input.years - elapsedYears;
    let dot: number;
    if (remaining <= fraction + 1e-9) dot = nbv; // dernière annuité : solde
    else {
      const deg = nbv * rate * fraction;
      const lin = (nbv / remaining) * fraction;
      dot = Math.max(deg, lin);
    }
    dot = Math.min(dot, nbv);
    out.push({ year, dotation: dot, firstMonths });
    nbv -= dot;
    elapsedYears += fraction;
    year++;
  }
  return out;
}

function dayBefore(d: string): string {
  const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10);
}

/** Cumul des amortissements à la date donnée (incluse), arrondi au franc. */
export function cumulativeAt(input: DeprInput, date: string): number {
  const cap = Math.max(0, input.base - (input.residual ?? 0) - (input.impairment ?? 0));
  const r = input.revision;
  if (r && input.inServiceDate && r.date > input.inServiceDate) {
    if (date < r.date) return Math.min(cap, cumulativeAt({ ...input, revision: null, impairment: 0, years: r.previousYears }, date));
    const elapsed = days360Inclusive(input.inServiceDate, dayBefore(r.date));
    const remainingDays = input.years * 360 - elapsed;
    const remaining = Math.max(0, input.base - (input.residual ?? 0) - r.cumulative);
    if (remainingDays <= 0) return Math.min(cap, r.cumulative + remaining);
    const done = days360Inclusive(r.date, date);
    return Math.round(Math.min(cap, r.cumulative + Math.min(remaining, (remaining * done) / remainingDays)));
  }
  return Math.min(cap, cumulativeBase(input, date));
}

function cumulativeBase(input: DeprInput, date: string): number {
  if (input.method === 'NON_AMORTISSABLE' || !input.inServiceDate || input.years <= 0) return 0;
  if (date < input.inServiceDate) return 0;
  const depreciable = Math.max(0, input.base - (input.residual ?? 0));
  if (input.method === 'LINEAIRE') {
    const days = days360Inclusive(input.inServiceDate, date);
    return Math.round(Math.min(depreciable, (depreciable * days) / (input.years * 360)));
  }
  // Dégressif : exercices écoulés + fraction de l'exercice en cours (en jours 30/360)
  const target = parse(date);
  let cum = 0;
  for (const line of degressiveYears({ ...input, residual: 0 })) {
    if (line.year < target.y) cum += line.dotation;
    else if (line.year === target.y) {
      const start = line.year === parse(input.inServiceDate).y ? `${line.year}-${String(12 - line.firstMonths + 1).padStart(2, '0')}-01` : `${line.year}-01-01`;
      const span = (line.year === parse(input.inServiceDate).y ? line.firstMonths : 12) * 30;
      const done = Math.min(span, Math.max(0, days360Inclusive(start, date)));
      cum += (line.dotation * done) / span;
    }
  }
  return Math.round(Math.min(input.base, cum));
}

/** Dernier jour du mois AAAA-MM. */
export function endOfMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, '0')}`;
}
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Dotation d'une période mensuelle AAAA-MM. */
export function dotationForPeriod(input: DeprInput, period: string): { amount: number; cumulativeAfter: number } {
  const after = cumulativeAt(input, endOfMonth(period));
  const before = cumulativeAt(input, endOfMonth(previousPeriod(period)));
  return { amount: after - before, cumulativeAfter: after };
}

/** Plan d'amortissement par exercice civil. */
export function schedule(input: DeprInput): ScheduleLine[] {
  if (input.method === 'NON_AMORTISSABLE' || !input.inServiceDate) return [];
  const first = parse(input.inServiceDate).y;
  const lines: ScheduleLine[] = [];
  let prev = 0;
  for (let y = first; y <= first + input.years + 1; y++) {
    const cum = cumulativeAt(input, `${y}-12-31`);
    const dot = cum - prev;
    if (dot <= 0 && y > first) break;
    lines.push({ year: y, dotation: dot, cumulative: cum, nbv: input.base - cum });
    prev = cum;
  }
  return lines;
}

/** Taux de vétusté = cumul / valeur d'origine. */
export function wearRate(input: DeprInput, date: string): number {
  if (!input.base) return 0;
  return cumulativeAt(input, date) / input.base;
}
