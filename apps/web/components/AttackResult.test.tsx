import { render, screen } from '@testing-library/react';
import { useActiveRun } from '@/hooks/useExperimentRuns';
import { useDosRunHistory, useDosRunResult } from '@/hooks/useDosMetrics';
import AttackResult from './AttackResult';

jest.mock('@/hooks/useExperimentRuns', () => ({
  useActiveRun: jest.fn(),
}));

jest.mock('@/hooks/useDosMetrics', () => ({
  useDosRunHistory: jest.fn(),
  useDosRunResult: jest.fn(),
}));

describe('AttackResult', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a placeholder when there is no Track B run yet', () => {
    (useActiveRun as jest.Mock).mockReturnValue({ data: null });
    (useDosRunHistory as jest.Mock).mockReturnValue({ data: [] });
    (useDosRunResult as jest.Mock).mockReturnValue({ data: undefined, isPending: false });

    render(<AttackResult />);

    expect(screen.getByText(/nenhuma run de track b ainda/i)).toBeInTheDocument();
  });

  it('shows "aguardando resultado" while the run is active but has no KPI yet', () => {
    (useActiveRun as jest.Mock).mockReturnValue({
      data: { id: 'run-1', mode: 'plain', attackType: 'connection-flood' },
    });
    (useDosRunHistory as jest.Mock).mockReturnValue({ data: [] });
    (useDosRunResult as jest.Mock).mockReturnValue({ data: null, isPending: false });

    render(<AttackResult />);

    expect(screen.getByText(/aguardando resultado do ataque/i)).toBeInTheDocument();
  });

  it('renders connection-flood KPIs once the result is persisted', () => {
    (useActiveRun as jest.Mock).mockReturnValue({ data: null });
    (useDosRunHistory as jest.Mock).mockReturnValue({
      data: [{ runId: 'run-1', trackBAttackType: 'connection-flood' }],
    });
    (useDosRunResult as jest.Mock).mockReturnValue({
      data: {
        runId: 'run-1',
        trackBAttackType: 'connection-flood',
        trackBResult: {
          connections_attempted: 100,
          connections_established: 42,
          connections_rejected: 58,
          success_rate: 0.42,
        },
      },
      isPending: false,
    });

    render(<AttackResult />);

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('42.0%')).toBeInTheDocument();
  });

  it('shows a link to the Grafana broker-metrics dashboard filtered by run_id when there is a relevant run', () => {
    (useActiveRun as jest.Mock).mockReturnValue({
      data: { id: 'run-1', mode: 'plain', attackType: 'connection-flood' },
    });
    (useDosRunHistory as jest.Mock).mockReturnValue({ data: [] });
    (useDosRunResult as jest.Mock).mockReturnValue({ data: null, isPending: false });

    render(<AttackResult />);

    const link = screen.getByRole('link', { name: /ver métricas do broker no grafana/i });
    expect(link).toHaveAttribute(
      'href',
      'http://localhost:3001/d/stressbed-broker-metrics/broker-metrics?var-run_id=run-1&from=now-15m&to=now',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not show the Grafana link when there is no relevant run', () => {
    (useActiveRun as jest.Mock).mockReturnValue({ data: null });
    (useDosRunHistory as jest.Mock).mockReturnValue({ data: [] });
    (useDosRunResult as jest.Mock).mockReturnValue({ data: undefined, isPending: false });

    render(<AttackResult />);

    expect(screen.queryByRole('link', { name: /ver métricas do broker no grafana/i })).not.toBeInTheDocument();
  });
});
