/** Types partagés de l'application d'inventaire hors ligne (miroir du paquet renvoyé par GET /mobile/paquet). */
export type Condition = 'NEUF' | 'BON' | 'MOYEN' | 'MAUVAIS' | 'HORS_USAGE';
export const CONDITIONS: [Condition, string][] = [['BON', 'Bon'], ['MOYEN', 'Moyen'], ['MAUVAIS', 'Mauvais'], ['HORS_USAGE', "Hors d'usage"]];
export const conditionLabel = (c: Condition) => (c === 'NEUF' ? 'Neuf' : CONDITIONS.find(([k]) => k === c)?.[1] ?? c);
export const needsJustification = (c: Condition) => c === 'MAUVAIS' || c === 'HORS_USAGE';

export interface PackZone { id: number; campaignId: number; name: string; status: 'A_FAIRE' | 'EN_COURS' | 'TERMINEE'; expectedCount: number; leader: string | null; locations: { id: number; path: string }[] }
export interface PackCampaign { id: number; number: string; label: string; blind: boolean; endDate: string; zones: PackZone[] }
export interface PackAsset { id: number; code: string; designation: string; category: string; condition: Condition; serial: string | null; holder: string | null; lastSeenAt: string | null; expectedLocation: string | null }
export interface Pack {
  generatedAt: string;
  user: { id: number; fullName: string };
  campaigns: PackCampaign[];
  assets: PackAsset[];
  /** Biens attendus par zone (absent en comptage à l'aveugle). */
  expected: Record<string, number[]>;
  /** Constats déjà enregistrés sur le serveur au moment du téléchargement. */
  counted: { zoneId: number; code: string; condition: Condition; countedAt: string; clientId: string | null; known: boolean }[];
  blindCampaigns: number[];
}

export type CountState = 'PENDING' | 'SYNCED' | 'REFUSE' | 'CONFLIT';
export interface LocalCount {
  clientId: string;
  campaignId: number;
  zoneId: number;
  code: string;
  condition: Condition;
  locationId: number | null;
  comment: string;
  countedAt: string;
  lat: number | null;
  lng: number | null;
  /** Reconnu dans le dictionnaire de l'appareil. */
  assetId: number | null;
  designation: string;
  state: CountState;
  serverStatus?: string;
  message?: string;
  photoIds: string[];
}
export interface LocalPhoto { photoId: string; clientId: string; uri: string; state: 'PENDING' | 'SENT' }

export interface Session { token: string; user: { id: number; fullName: string; role: string; email: string }; server: string }
export interface AppData {
  deviceId: string;
  server: string;
  session: Session | null;
  pack: Pack | null;
  counts: LocalCount[];
  photos: LocalPhoto[];
  lastSyncAt: string | null;
  closedZones: number[];
  /** Compte auteur des constats de l'appareil : seul ce compte peut les transmettre. */
  owner: string | null;
}
export const emptyData = (deviceId: string, server: string): AppData => ({ deviceId, server, session: null, pack: null, counts: [], photos: [], lastSyncAt: null, closedZones: [], owner: null });
