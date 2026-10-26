import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, download, upload } from '../api';
import { useAuth } from '../auth';
import { DOC_CATEGORY, date } from '../format';
import type { Row } from '../types';
import { Card, Empty, Field, Loading, Modal, Mono, useAction, useToast } from './ui';

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/** Pièces justificatives rattachées à un objet métier (bien, contrat, ordre de travail…). */
export function Documents({ objectType, objectId, title = 'Pièces justificatives', defaultCategory = 'FACTURE' }: { objectType: string; objectId: number; title?: string; defaultCategory?: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['documents', objectType, objectId], queryFn: () => api<{ items: Row[] }>(`/documents?objectType=${objectType}&objectId=${objectId}`) });
  const items = q.data?.items ?? [];
  return (
    <Card pad={false} title={`${title} (${items.length})`} extra={can('documents.write') && <button className="btn small" onClick={() => setOpen(true)}>Joindre un document</button>}>
      {q.isLoading ? <Loading /> : !items.length ? <Empty>Aucune pièce jointe.</Empty> : (
        <ul className="list" style={{ padding: '0 20px' }}>
          {items.map((d) => (
            <li key={d.id}>
              <span className="doc-ico" aria-hidden="true">{d.mime === 'application/pdf' ? 'PDF' : d.mime.startsWith('image/') ? 'IMG' : 'DOC'}</span>
              <span className="grow"><button className="linkish" onClick={() => download(`/documents/${d.id}/fichier`, d.filename, d.mime === 'application/pdf' || d.mime.startsWith('image/')).catch((e) => toast(e.message, 'bad'))}>{d.filename}</button>
                <span className="small muted">{d.categoryLabel} · {size(d.size)} · {d.by ?? '—'} · {date(d.uploadedAt ?? d.createdAt)}</span></span>
              <span className="small muted" title={`Empreinte SHA-256 : ${d.sha256}`}>SHA-256 <Mono>{d.sha256.slice(0, 10)}…</Mono></span>
            </li>
          ))}
        </ul>
      )}
      {open && <UploadModal objectType={objectType} objectId={objectId} defaultCategory={defaultCategory} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function UploadModal({ objectType, objectId, defaultCategory, onClose }: { objectType: string; objectId: number; defaultCategory: string; onClose: () => void }) {
  const [category, setCategory] = useState(defaultCategory);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const act = useAction(() => {
    const f = new FormData();
    f.append('objectType', objectType); f.append('objectId', String(objectId)); f.append('category', category); f.append('file', file!);
    return upload('/documents', f);
  }, { success: 'Document enregistré avec son empreinte', invalidate: [['documents']], onDone: onClose });
  return (
    <Modal title="Joindre un document" onClose={onClose}>
      <Field label="Nature de la pièce" htmlFor="dc"><select id="dc" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(DOC_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Fichier" htmlFor="df" hint="PDF, image, Word, Excel ou CSV · 20 Mo au plus. Une empreinte SHA-256 garantit que la pièce n'est pas altérée.">
        <input id="df" ref={input} type="file" className="input" style={{ paddingTop: 8 }} accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={!file || act.isPending} onClick={() => act.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}
