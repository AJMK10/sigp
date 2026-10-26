import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Kpi, StatusPill } from './ui';
import { ASSET_STATUS } from '../format';

describe('composants', () => {
  it('affiche un statut avec son libellé', () => {
    render(<StatusPill map={ASSET_STATUS} value="EN_MAINTENANCE" />);
    expect(screen.getByText('En maintenance')).toHaveClass('pill', 'warn');
  });
  it('rend un indicateur cliquable quand une cible est fournie', () => {
    render(<MemoryRouter><Kpi label="Biens actifs" value="48 216" to="/biens" /></MemoryRouter>);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/biens');
  });
});
