import { fireEvent, render, screen } from '@testing-library/react';
import { useActiveRun } from '@/hooks/useExperimentRuns';
import AttackForm from './AttackForm';

jest.mock('@/hooks/useExperimentRuns', () => ({
  useActiveRun: jest.fn(),
}));

describe('AttackForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useActiveRun as jest.Mock).mockReturnValue({ data: null });
    Object.assign(navigator, { clipboard: { writeText: jest.fn() } });
  });

  it('exposes no button that could trigger the attack — "Copiar" is the only action, the console never calls the backend to start a run', () => {
    render(<AttackForm />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/copiar/i);
  });

  it('builds the default connection-flood command', () => {
    render(<AttackForm />);

    expect(screen.getByDisplayValue('./scripts/run-experiment.sh connection-flood plain')).toBeInTheDocument();
  });

  it('updates the command when a flag is filled in', () => {
    render(<AttackForm />);

    fireEvent.change(screen.getByLabelText(/--connections/), { target: { value: '250' } });

    expect(
      screen.getByDisplayValue('./scripts/run-experiment.sh connection-flood plain -- --connections 250')
    ).toBeInTheDocument();
  });

  it('always includes --mode for malformed-payload, since the script requires it', () => {
    render(<AttackForm />);

    fireEvent.change(screen.getByLabelText(/^ataque$/i), { target: { value: 'malformed-payload' } });

    expect(
      screen.getByDisplayValue('./scripts/run-experiment.sh malformed-payload plain -- --mode giant')
    ).toBeInTheDocument();
  });

  it('disables the fields when there is an active run', () => {
    (useActiveRun as jest.Mock).mockReturnValue({
      data: { id: 'run-1', mode: 'plain', attackType: 'connection-flood' },
    });

    render(<AttackForm />);

    expect(screen.getByLabelText(/^ataque$/i)).toBeDisabled();
    expect(screen.getByText(/já existe uma run ativa/i)).toBeInTheDocument();
  });
});
