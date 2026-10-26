import { big, date, fcfa, pct, periodLabel } from './format';

describe('formatage', () => {
  it('formate les montants en FCFA', () => {
    expect(fcfa(1234567).replace(/\s/g, ' ')).toBe('1 234 567');
    expect(fcfa(null)).toBe('—');
  });
  it('abrège les grands montants', () => {
    expect(big(18_450_000_000)).toBe('18,45 Md');
    expect(big(14_000_000)).toBe('14 M');
  });
  it('formate dates, périodes et pourcentages', () => {
    expect(date('2026-10-26')).toBe('26/10/2026');
    expect(periodLabel('2026-09')).toBe('sept. 2026');
    expect(pct(0.468)).toBe('46,8 %');
  });
});
