import { cumulativeAt, days360Inclusive, dotationForPeriod, schedule, degressiveCoefficient } from './engine';

describe('moteur d\'amortissement', () => {
  it('compte les jours en 30/360 bornes incluses', () => {
    expect(days360Inclusive('2026-01-01', '2026-01-31')).toBe(30);
    expect(days360Inclusive('2026-01-01', '2026-12-31')).toBe(360);
    expect(days360Inclusive('2026-01-15', '2026-01-31')).toBe(16);
  });

  it('amortit en linéaire avec prorata au jour', () => {
    const a = { base: 12_000_000, method: 'LINEAIRE' as const, years: 5, inServiceDate: '2026-07-01' };
    expect(cumulativeAt(a, '2026-12-31')).toBe(1_200_000); // 6 mois sur 60
    expect(cumulativeAt(a, '2031-06-30')).toBe(12_000_000);
    expect(cumulativeAt(a, '2035-01-01')).toBe(12_000_000); // jamais au-delà de la base
    expect(cumulativeAt(a, '2026-06-30')).toBe(0);
  });

  it('tient compte de la valeur résiduelle', () => {
    const a = { base: 10_000_000, residual: 1_000_000, method: 'LINEAIRE' as const, years: 3, inServiceDate: '2026-01-01' };
    expect(cumulativeAt(a, '2030-12-31')).toBe(9_000_000);
  });

  it('dotation mensuelle = écart des cumuls, et la somme égale le cumul', () => {
    const a = { base: 1_000_000, method: 'LINEAIRE' as const, years: 3, inServiceDate: '2026-03-17' };
    let sum = 0;
    for (let m = 1; m <= 12; m++) sum += dotationForPeriod(a, `2026-${String(m).padStart(2, '0')}`).amount;
    expect(sum).toBe(cumulativeAt(a, '2026-12-31'));
    expect(dotationForPeriod(a, '2026-02').amount).toBe(0);
  });

  it('applique les coefficients dégressifs SYSCOHADA', () => {
    expect(degressiveCoefficient(4)).toBe(1.5);
    expect(degressiveCoefficient(5)).toBe(2);
    expect(degressiveCoefficient(10)).toBe(2.5);
  });

  it('amortit en dégressif et solde le bien sur sa durée', () => {
    const a = { base: 10_000_000, method: 'DEGRESSIF' as const, years: 5, inServiceDate: '2026-01-01' };
    const plan = schedule(a);
    expect(plan[0].dotation).toBe(4_000_000); // 10 M × 40 %
    expect(plan[plan.length - 1].nbv).toBe(0);
    expect(plan.reduce((s, l) => s + l.dotation, 0)).toBe(10_000_000);
    expect(plan.length).toBe(5);
  });

  it('applique le prorata en mois la première année en dégressif', () => {
    const a = { base: 12_000_000, method: 'DEGRESSIF' as const, years: 5, inServiceDate: '2026-10-15' };
    expect(schedule(a)[0].dotation).toBe(1_200_000); // 12 M × 40 % × 3/12
  });

  it('ne calcule rien pour un bien non amortissable ou non mis en service', () => {
    expect(cumulativeAt({ base: 5, method: 'NON_AMORTISSABLE', years: 0, inServiceDate: '2020-01-01' }, '2026-01-01')).toBe(0);
    expect(cumulativeAt({ base: 5, method: 'LINEAIRE', years: 5, inServiceDate: null }, '2026-01-01')).toBe(0);
  });
});

describe('révision de durée et dépréciation', () => {
  it('étale le solde restant sur la nouvelle durée à partir de la date d\'effet, sans retraiter le passé', () => {
    const before = { base: 12_000_000, method: 'LINEAIRE' as const, years: 10, inServiceDate: '2020-01-01' };
    const cumAtRevision = cumulativeAt(before, '2025-12-31'); // 6 ans sur 10
    expect(cumAtRevision).toBe(7_200_000);
    const after = { ...before, years: 12, revision: { date: '2026-01-01', cumulative: cumAtRevision, previousYears: 10 } };
    expect(cumulativeAt(after, '2025-06-30')).toBe(cumulativeAt(before, '2025-06-30'));
    expect(cumulativeAt(after, '2026-12-31')).toBe(7_200_000 + 800_000); // 4,8 M sur 6 ans restants
    expect(cumulativeAt(after, '2031-12-31')).toBe(12_000_000);
  });
  it('plafonne les amortissements après dépréciation', () => {
    const a = { base: 1_000_000, method: 'LINEAIRE' as const, years: 2, inServiceDate: '2025-01-01', impairment: 300_000 };
    expect(cumulativeAt(a, '2027-01-01')).toBe(700_000);
  });
});
