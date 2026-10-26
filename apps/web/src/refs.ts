import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Row } from './types';

const opts = { staleTime: 5 * 60_000 };
export const useCategories = () => useQuery({ queryKey: ['refs', 'categories'], queryFn: () => api<Row[]>('/referentiels/categories'), ...opts });
export const useLocations = () => useQuery({ queryKey: ['refs', 'locations'], queryFn: () => api<Row[]>('/referentiels/localisations'), ...opts });
export const useOrgUnits = () => useQuery({ queryKey: ['refs', 'orgUnits'], queryFn: () => api<Row[]>('/referentiels/structures'), ...opts });
export const usePeople = () => useQuery({ queryKey: ['refs', 'people'], queryFn: () => api<Row[]>('/referentiels/personnes'), ...opts });
/** Catégories de dernier niveau (porteuses d'un préfixe de codification). */
export const leafCategories = (c?: Row[]) => (c ?? []).filter((x) => x.prefix && x.active);
