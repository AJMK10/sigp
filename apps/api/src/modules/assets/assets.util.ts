import { assets } from '../../db/schema';
import { cumulativeAt, DeprInput } from '../depreciation/engine';

export type AssetRow = typeof assets.$inferSelect;
export const today = () => new Date().toISOString().slice(0, 10);
export function deprInput(a: Pick<AssetRow, 'acquisitionValue' | 'residualValue' | 'deprMethod' | 'deprYears' | 'inServiceDate'>): DeprInput {
  return { base: a.acquisitionValue, residual: a.residualValue, method: a.deprMethod, years: a.deprYears, inServiceDate: a.inServiceDate };
}
/** Valeurs à une date : cumul, VNC, vétusté. Un bien sorti garde ses valeurs à la date de sortie. */
export function valuesAt(a: AssetRow, date = today()) {
  const d = a.exitDate && a.exitDate < date ? a.exitDate : date;
  const cum = cumulativeAt(deprInput(a), d);
  return { cumulative: cum, nbv: a.acquisitionValue - cum, wear: a.acquisitionValue ? cum / a.acquisitionValue : 0 };
}
export const STATUS_LABELS: Record<string, string> = {
  EN_STOCK: 'En stock', EN_SERVICE: 'En service', EN_MAINTENANCE: 'En maintenance', EN_PRET: 'En prêt', EN_TRANSIT: 'En transit',
  MANQUANT: 'Manquant', PROPOSE_REFORME: 'Proposé à la réforme', SORTI: 'Sorti du patrimoine',
};
