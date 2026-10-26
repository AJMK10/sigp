import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';

const DEMO = [['konan.a@sigp.ci', 'Directeur du patrimoine'], ['yao.k@sigp.ci', 'Gestionnaire'], ['kone.d@sigp.ci', 'Comptable-matières'], ['coulibaly.n@sigp.ci', 'Direction financière'],
  ['diallo.f@sigp.ci', 'Contrôleur financier'], ['bamba.s@sigp.ci', "Chef d'équipe d'inventaire"], ['traore.m@sigp.ci', 'Détenteur'], ['admin@sigp.ci', 'Administrateur']];

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('konan.a@sigp.ci');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(email, password); } catch (err) { setError(err instanceof Error ? err.message : 'Connexion impossible'); } finally { setBusy(false); }
  };
  const tick = <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8FC1F2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>;
  return (
    <div className="login">
      <section className="login-hero">
        <div className="brand" style={{ padding: 0 }}><span className="brand-mark" style={{ width: 44, height: 44, fontSize: 16 }}>SI</span><span><strong style={{ fontSize: 20 }}>SIGP</strong><small>Système Intégré de Gestion du Patrimoine</small></span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h1>Chaque bien recensé, localisé et valorisé.</h1>
          <p>Un registre unique pour les entreprises et les administrations : acquisition, affectation, inventaire, amortissements et comptabilité-matières.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 15 }}>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{tick}Conforme SYSCOHADA révisé et comptabilité-matières UEMOA</span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{tick}Circuits de validation et séparation des tâches</span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{tick}Piste d'audit inaltérable pour les organes de contrôle</span>
          </div>
        </div>
        <span style={{ fontSize: 13, color: '#A9B9CE' }}>Version 1.0 · lot 1</span>
      </section>
      <section className="login-form-wrap">
        <form className="card login-form" onSubmit={submit}>
          <div><h2 style={{ fontSize: 24, color: 'var(--navy)' }}>Connexion</h2><span className="muted">Accédez à l'espace de votre organisation.</span></div>
          <div className="field"><label htmlFor="email">Adresse e-mail professionnelle</label><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pwd">Mot de passe</label><input id="pwd" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {error && <div className="note bad" role="alert">{error}</div>}
          <button className="btn primary" style={{ minHeight: 48 }} disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Comptes de démonstration (mot de passe : Sigp2026!)</summary>
            <ul className="list" style={{ marginTop: 8 }}>
              {DEMO.map(([m, r]) => <li key={m}><button type="button" className="btn small" onClick={() => { setEmail(m); setPassword('Sigp2026!'); }}>{m}</button><span className="small muted">{r}</span></li>)}
            </ul>
          </details>
        </form>
      </section>
    </div>
  );
}
