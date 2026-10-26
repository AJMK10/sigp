import { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Validations } from './pages/Validations';
import { Notifications } from './pages/Notifications';
import { Biens } from './pages/Biens';
import { FicheBien } from './pages/FicheBien';
import { NouveauBien } from './pages/NouveauBien';
import { Etiquettes, ReceptionDetail, ReceptionForm, Receptions } from './pages/Receptions';
import { MouvementDetail, Mouvements, NouveauMouvement } from './pages/Mouvements';
import { Campagne, Comptage, Ecarts, Inventaires, NouvelleCampagne } from './pages/Inventaires';
import { CalculDetail, EcritureDetail, Ecritures, Valorisation } from './pages/Valorisation';
import { NouvelleReforme, ReformeDetail, Reformes } from './pages/Reformes';
import { Audit, Etats, Parametrage, Structures, Utilisateurs } from './pages/Admin';
import { Demandes, Portail } from './pages/Portail';
import { ImmoFiche, Immobilier } from './pages/Immobilier';
import { Flotte, Missions, Vehicule } from './pages/Flotte';
import { ContratDetail, Contrats, Maintenance, OtDetail } from './pages/Maintenance';
import { Cloture, ComptaMatieres, Ged, NouvelleRevision, Renouvellement, RevisionDetail, Revisions } from './pages/Pilotage2';

function Guard({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...perms) ? <>{children}</> : <div className="note warn">Votre profil ne donne pas accès à cet écran.</div>;
}

export function App() {
  const { me, loading, can } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Login />;
  const home = can('dashboard.read') ? <Dashboard /> : can('inventory.count') ? <Navigate to="/inventaires" replace /> : <Navigate to="/portail" replace />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={home} />
        <Route path="/validations" element={<Validations />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/etats" element={<Guard perms={['reports.read']}><Etats /></Guard>} />
        <Route path="/biens" element={<Guard perms={['assets.read']}><Biens /></Guard>} />
        <Route path="/biens/nouveau" element={<Guard perms={['assets.write']}><NouveauBien /></Guard>} />
        <Route path="/biens/:id" element={<FicheBien />} />
        <Route path="/receptions" element={<Guard perms={['receptions.write', 'receptions.validate']}><Receptions /></Guard>} />
        <Route path="/receptions/nouvelle" element={<Guard perms={['receptions.write']}><ReceptionForm /></Guard>} />
        <Route path="/receptions/:id" element={<ReceptionDetail />} />
        <Route path="/receptions/:id/modifier" element={<Guard perms={['receptions.write']}><ReceptionForm /></Guard>} />
        <Route path="/etiquettes" element={<Guard perms={['labels.manage']}><Etiquettes /></Guard>} />
        <Route path="/mouvements" element={<Mouvements />} />
        <Route path="/mouvements/nouveau" element={<Guard perms={['movements.write']}><NouveauMouvement /></Guard>} />
        <Route path="/mouvements/:id" element={<MouvementDetail />} />
        <Route path="/inventaires" element={<Inventaires />} />
        <Route path="/inventaires/nouvelle" element={<Guard perms={['inventory.manage']}><NouvelleCampagne /></Guard>} />
        <Route path="/inventaires/:id" element={<Campagne />} />
        <Route path="/inventaires/:id/zones/:zoneId" element={<Comptage />} />
        <Route path="/inventaires/:id/ecarts" element={<Ecarts />} />
        <Route path="/valorisation" element={<Guard perms={['depreciation.read']}><Valorisation /></Guard>} />
        <Route path="/valorisation/calculs/:id" element={<CalculDetail />} />
        <Route path="/ecritures" element={<Guard perms={['journal.read']}><Ecritures /></Guard>} />
        <Route path="/ecritures/:id" element={<EcritureDetail />} />
        <Route path="/reformes" element={<Guard perms={['disposals.write', 'disposals.validate']}><Reformes /></Guard>} />
        <Route path="/reformes/nouvelle" element={<Guard perms={['disposals.write']}><NouvelleReforme /></Guard>} />
        <Route path="/reformes/:id" element={<ReformeDetail />} />
        <Route path="/parametrage" element={<Guard perms={['settings.manage']}><Parametrage /></Guard>} />
        <Route path="/parametrage/structures" element={<Guard perms={['settings.manage']}><Structures /></Guard>} />
        <Route path="/utilisateurs" element={<Guard perms={['users.manage']}><Utilisateurs /></Guard>} />
        <Route path="/audit" element={<Guard perms={['audit.read']}><Audit /></Guard>} />
        <Route path="/portail" element={<Guard perms={['portal.use']}><Portail /></Guard>} />
        <Route path="/portail/demandes" element={<Navigate to="/demandes" replace />} />
        <Route path="/demandes" element={<Guard perms={['assets.write']}><Demandes /></Guard>} />
        <Route path="/immobilier" element={<Guard perms={['property.manage', 'reports.read']}><Immobilier /></Guard>} />
        <Route path="/immobilier/:id" element={<Guard perms={['property.manage', 'reports.read']}><ImmoFiche /></Guard>} />
        <Route path="/flotte" element={<Guard perms={['fleet.manage', 'reports.read']}><Flotte /></Guard>} />
        <Route path="/flotte/:id" element={<Guard perms={['fleet.manage', 'reports.read']}><Vehicule /></Guard>} />
        <Route path="/missions" element={<Guard perms={['fleet.use', 'fleet.manage']}><Missions /></Guard>} />
        <Route path="/maintenance" element={<Guard perms={['maintenance.manage', 'reports.read']}><Maintenance /></Guard>} />
        <Route path="/maintenance/ot/:id" element={<Guard perms={['maintenance.manage', 'assets.read']}><OtDetail /></Guard>} />
        <Route path="/contrats" element={<Guard perms={['contracts.manage', 'assets.read']}><Contrats /></Guard>} />
        <Route path="/contrats/:id" element={<Guard perms={['contracts.manage', 'assets.read']}><ContratDetail /></Guard>} />
        <Route path="/revisions" element={<Guard perms={['revaluation.write', 'depreciation.read']}><Revisions /></Guard>} />
        <Route path="/revisions/nouvelle" element={<Guard perms={['revaluation.write']}><NouvelleRevision /></Guard>} />
        <Route path="/revisions/:id" element={<Guard perms={['revaluation.write', 'depreciation.read']}><RevisionDetail /></Guard>} />
        <Route path="/cloture" element={<Guard perms={['closing.manage']}><Cloture /></Guard>} />
        <Route path="/comptabilite-matieres" element={<Guard perms={['reports.read']}><ComptaMatieres /></Guard>} />
        <Route path="/renouvellement" element={<Guard perms={['reports.read', 'depreciation.read']}><Renouvellement /></Guard>} />
        <Route path="/documents" element={<Guard perms={['documents.write', 'audit.read']}><Ged /></Guard>} />
        <Route path="*" element={<div className="note warn">Page introuvable.</div>} />
      </Routes>
    </Layout>
  );
}
