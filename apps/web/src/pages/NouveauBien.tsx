import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../api';
import { CONDITION, today } from '../format';
import { leafCategories, useCategories, useLocations, useOrgUnits } from '../refs';
import { Card, Field, Note, PageHead, useAction } from '../components/ui';
import type { Row } from '../types';

export function NouveauBien() {
  const nav = useNavigate();
  const cats = useCategories(); const locs = useLocations(); const units = useOrgUnits();
  const [f, setF] = useState({ designation: '', categoryId: '', entryMode: 'REPRISE', acquisitionDate: today(), inServiceDate: '', acquisitionValue: '', serialNumber: '', brand: '', model: '', locationId: '', orgUnitId: '', condition: 'BON', supplier: '', justification: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(() => post<Row>('/biens', {
    ...f, categoryId: Number(f.categoryId), acquisitionValue: Number(f.acquisitionValue), inServiceDate: f.inServiceDate || null, locationId: f.locationId ? Number(f.locationId) : null,
    orgUnitId: f.orgUnitId ? Number(f.orgUnitId) : null, serialNumber: f.serialNumber || undefined, brand: f.brand || undefined, model: f.model || undefined, supplier: f.supplier || undefined,
  }), { success: (a) => `Bien immatriculé : ${a.code}`, invalidate: [['assets']], onDone: (a) => nav(`/biens/${a.id}`) });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(undefined); };
  return (
    <>
      <PageHead title="Entrée manuelle au registre" sub="Pour la reprise de l'existant, les dons, les transferts entrants et les régularisations d'inventaire. Les achats passent par une réception." />
      <form onSubmit={submit} className="split">
        <div className="wide">
          <Card title="Identification">
            <Field label="Désignation" htmlFor="d"><input id="d" className="input" required value={f.designation} onChange={set('designation')} /></Field>
            <div className="grid" style={{ ['--min' as string]: '220px' }}>
              <Field label="Catégorie" htmlFor="c"><select id="c" className="input" required value={f.categoryId} onChange={set('categoryId')}><option value="">Choisir…</option>
                {leafCategories(cats.data).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.label} ({c.durationYears} ans)</option>)}</select></Field>
              <Field label="Mode d'entrée" htmlFor="m"><select id="m" className="input" value={f.entryMode} onChange={set('entryMode')}>
                <option value="REPRISE">Reprise de l'existant</option><option value="DON">Don ou legs</option><option value="TRANSFERT_ENTRANT">Transfert entrant</option><option value="PRODUCTION">Production interne</option><option value="REGULARISATION">Régularisation d'inventaire</option></select></Field>
              <Field label="N° de série" htmlFor="sn"><input id="sn" className="input" value={f.serialNumber} onChange={set('serialNumber')} /></Field>
              <Field label="État" htmlFor="co"><select id="co" className="input" value={f.condition} onChange={set('condition')}>{Object.entries(CONDITION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Marque" htmlFor="b"><input id="b" className="input" value={f.brand} onChange={set('brand')} /></Field>
              <Field label="Modèle" htmlFor="mo"><input id="mo" className="input" value={f.model} onChange={set('model')} /></Field>
            </div>
          </Card>
          <Card title="Valeur">
            <div className="grid" style={{ ['--min' as string]: '200px' }}>
              <Field label="Valeur d'entrée (FCFA)" htmlFor="v" hint="Coût historique, valeur vénale (don) ou valeur estimée par la commission"><input id="v" className="input" type="number" min="0" required value={f.acquisitionValue} onChange={set('acquisitionValue')} /></Field>
              <Field label="Date d'acquisition" htmlFor="ad"><input id="ad" className="input" type="date" required value={f.acquisitionDate} onChange={set('acquisitionDate')} /></Field>
              <Field label="Date de mise en service" htmlFor="sd" hint="Vide si le bien reste en stock"><input id="sd" className="input" type="date" value={f.inServiceDate} onChange={set('inServiceDate')} /></Field>
              <Field label="Origine (fournisseur, donateur…)" htmlFor="su"><input id="su" className="input" value={f.supplier} onChange={set('supplier')} /></Field>
            </div>
          </Card>
        </div>
        <div className="narrow">
          <Card title="Localisation">
            <Field label="Localisation" htmlFor="l"><select id="l" className="input" value={f.locationId} onChange={set('locationId')}><option value="">Non précisée</option>{locs.data?.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}</select></Field>
            <Field label="Service" htmlFor="o"><select id="o" className="input" value={f.orgUnitId} onChange={set('orgUnitId')}><option value="">Non précisé</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          </Card>
          <Card title="Justification">
            <Field label="Pièce ou motif" htmlFor="j" hint="Obligatoire : tracé au journal d'audit"><textarea id="j" className="input" rows={3} required value={f.justification} onChange={set('justification')} placeholder="PV de la commission d'évaluation du …, convention de don n° …" /></Field>
            <Note>Le code définitif est attribué à l'enregistrement, selon le préfixe de la catégorie et l'année d'acquisition.</Note>
            <button className="btn primary" disabled={save.isPending}>Immatriculer le bien</button>
          </Card>
        </div>
      </form>
    </>
  );
}
