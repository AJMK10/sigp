/* Réponses de l'API : typage léger, les écrans lisent les champs dont ils ont besoin. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export interface Paged<T = Row> { total: number; page: number; pageSize: number; items: T[]; grossValue?: number }
