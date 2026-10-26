import { fireEvent, render, screen } from '@testing-library/react';
import { useActiveRun, useLaunchRun } from '@/hooks/useExperimentRuns';
import AttackForm from './AttackForm';

jest.mock('@/hooks/useExperimentRuns', () => ({
  useActiveRun: jest.fn(),
  useLaunchRun: jest.fn(),
  describeLaunchError: (error: unknown) => `erro: ${(error as Error).message}`,
}));

const mutate = jest.fn();

function mockLaunch(overrides: Record<string, unknown> = {}) {
  (useLaunchRun as jest.Mock).mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  });
}

describe('AttackForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useActiveRun as jest.Mock).mockReturnValue({ data: null });
    mockLaunch();
    Object.assign(navigator, { clipboard: { writeText: jest.fn() } });
  });

  it('has a primary "Disparar ataque" button and keeps "Copiar" as the secondary action', () => {
    render(<AttackForm />);

    expect(screen.getByRole('button', { name: /disparar ataque/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /copiar/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('launches the default connection-flood with no params', () => {
    render(<AttackForm />);

    fireEvent.click(screen.getByRole('button', { name: /disparar ataque/i }));

    expect(mutate).toHaveBeenCalledWith({
      mode: 'plain',
      attackType: 'connection-flood',
      params: {},
    });
  });

  it('launches with the filled fields as numeric params, the same ones the command shows', () => {
    render(<AttackForm />);
    fireEvent.change(screen.getByLabelText(/--connections/), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText(/--hold-seconds/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/^alvo$/i), { target: { value: 'secure' } });

    fireEvent.click(screen.getByRole('button', { name: /disparar ataque/i }));

    expect(mutate).toHaveBeenCalledWith({
      mode: 'secure',
      attackType: 'connection-flood',
      params: { connections: 250, 'hold-seconds': 3 },
    });
    expect(
      screen.getByDisplayValue(
        './scripts/run-experiment.sh connection-flood secure -- --connections 250 --hold-seconds 3',
      ),
    ).toBeInTheDocument();
  });

  it('launches message-flood with its own flags', () => {
    render(<AttackForm />);
    fireEvent.change(screen.getByLabelText(/^ataque$/i), { target: { value: 'message-flood' } });
    fireEvent.change(screen.getByLabelText(/--rate/), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/--duration-seconds/), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: /disparar ataque/i }));

    expect(mutate).toHaveBeenCalledWith({
      mode: 'plain',
      attackType: 'message-flood',
      params: { rate: 200, 'duration-seconds': 10 },
    });
  });

  it('always sends --mode for malformed-payload and only adds size-bytes for giant', () => {
    render(<AttackForm />);
    fireEvent.change(screen.getByLabelText(/^ataque$/i), { target: { value: 'malformed-payload' } });
    fireEvent.click(screen.getByRole('button', { name: /disparar ataque/i }));
    expect(mutate).toHaveBeenLastCalledWith({
      mode: 'plain',
      attackType: 'malformed-payload',
      params: { mode: 'giant' },
    });

    fireEvent.change(screen.getByLabelText(/--size-bytes/), { target: { value: '1000000' } });
    fireEvent.click(screen.getByRole('button', { name: /disparar ataque/i }));
    expect(mutate).toHaveBeenLastCalledWith({
      mode: 'plain',
      attackType: 'malformed-payload',
      params: { mode: 'giant', 'size-bytes': 1000000 },
    });

    fireEvent.change(screen.getByLabelText(/^--mode$/), { target: { value: 'invalid-json' } });
    fireEvent.click(screen.getByRole('button', { name: /disparar ataque/i }));
    expect(mutate).toHaveBeenLastCalledWith({
      mode: 'plain',
      attackType: 'malformed-payload',
      params: { mode: 'invalid-json' },
    });
  });

  it('disables the button and shows progress while the launch is pending', () => {
    mockLaunch({ isPending: true });

    render(<AttackForm />);

    expect(screen.getByRole('button', { name: /disparando/i })).toBeDisabled();
  });

  it('shows the launch error', () => {
    mockLaunch({ isError: true, error: new Error('boom') });

    render(<AttackForm />);

    expect(screen.getByText('erro: boom')).toBeInTheDocument();
  });

  it('does not launch while there is an active run', () => {
    (useActiveRun as jest.Mock).mockReturnValue({
      data: { id: 'run-1', mode: 'plain', attackType: 'connection-flood' },
    });

    render(<AttackForm />);

    expect(screen.getByRole('button', { name: /disparar ataque/i })).toBeDisabled();
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

  it('updates the command when --connect-timeout is filled in', () => {
    render(<AttackForm />);

    fireEvent.change(screen.getByLabelText(/--connect-timeout/), { target: { value: '15' } });

    expect(
      screen.getByDisplayValue('./scripts/run-experiment.sh connection-flood plain -- --connect-timeout 15')
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
