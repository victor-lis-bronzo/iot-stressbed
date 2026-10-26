import { HttpAttackRunnerAdapter } from './http-attack-runner.adapter';

describe('HttpAttackRunnerAdapter', () => {
  const adapter = new HttpAttackRunnerAdapter({
    baseUrl: 'http://attacker:8080',
    timeoutMs: 5000,
  });
  const request = {
    attackType: 'connection-flood' as const,
    mode: 'plain' as const,
    args: ['--connections', '5'],
  };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  const reply = (status: number, body: unknown) =>
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  it('POSTs the request as JSON to /run and maps the response', async () => {
    reply(200, { result: { attempted: 5 }, exitCode: 0, stderr: 'log' });

    const out = await adapter.run(request);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://attacker:8080/run');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(request);
    expect(out).toEqual({
      result: { attempted: 5 },
      exitCode: 0,
      stderr: 'log',
    });
  });

  it('defaults a missing result/exitCode instead of crashing', async () => {
    reply(200, {});
    expect(await adapter.run(request)).toEqual({
      result: null,
      exitCode: -1,
      stderr: '',
    });
  });

  it('throws with the runner error message on a non-2xx answer', async () => {
    reply(400, { error: 'flag não permitida para connection-flood: --host' });
    await expect(adapter.run(request)).rejects.toThrow(/flag não permitida/);
  });

  it('throws with the status when the error body is not JSON', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 502 }));
    await expect(adapter.run(request)).rejects.toThrow(/HTTP 502/);
  });

  it('propagates a network failure', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    await expect(adapter.run(request)).rejects.toThrow('fetch failed');
  });
});
