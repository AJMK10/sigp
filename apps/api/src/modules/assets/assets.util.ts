import { assets } from '../../db/schema';
import { cumulativeAt, DeprInput } from '../depreciation/engine';

export type AssetRow = typeof assets.$inferSelect;
export const today = () => new Date().toISOString().slice(0, 10);
type DeprFields = Pick<AssetRow, 'acquisitionValue' | 'residualValue' | 'deprMethod' | 'deprYears' | 'inServiceDate'> & Partial<Pick<AssetRow, 'revisedAt' | 'revisedCumulative' | 'previousYears' | 'impairment'>>;
export function deprInput(a: DeprFields): DeprInput {
  return {
    base: a.acquisitionValue, residual: a.residualValue, method: a.deprMethod, years: a.deprYears, inServiceDate: a.inServiceDate, impairment: a.impairment ?? 0,
    revision: a.revisedAt && a.revisedCumulative != null && a.previousYears ? { date: a.revisedAt, cumulative: a.revisedCumulative, previousYears: a.previousYears } : null,
  };
}
/** Valeurs à une date : cumul, VNC, vétusté. Un bien sorti garde ses valeurs à la date de sortie. */
export function valuesAt(a: AssetRow, date = today()) {
  const d = a.exitDate && a.exitDate < date ? a.exitDate : date;
  const cum = cumulativeAt(deprInput(a), d);
  return { cumulative: cum, impairment: a.impairment ?? 0, nbv: a.acquisitionValue - cum - (a.impairment ?? 0), wear: a.acquisitionValue ? cum / a.acquisitionValue : 0 };
}
export const STATUS_LABELS: Record<string, string> = {
  EN_STOCK: 'En stock', EN_SERVICE: 'En service', EN_MAINTENANCE: 'En maintenance', EN_PRET: 'En prêt', EN_TRANSIT: 'En transit',
  MANQUANT: 'Manquant', PROPOSE_REFORME: 'Proposé à la réforme', SORTI: 'Sorti du patrimoine',
};
