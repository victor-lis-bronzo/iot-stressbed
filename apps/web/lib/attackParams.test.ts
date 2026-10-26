import { numericParams, toCommand } from './attackParams';

describe('numericParams', () => {
  it('keeps only filled numeric fields, in order, as numbers', () => {
    expect(
      numericParams([
        ['connections', '250'],
        ['hold-seconds', ''],
        ['connect-timeout', '2.5'],
      ]),
    ).toEqual({ connections: 250, 'connect-timeout': 2.5 });
    expect(Object.keys(numericParams([['b', '1'], ['a', '2']]))).toEqual(['b', 'a']);
  });

  it('skips undefined, blank and non-numeric values', () => {
    expect(numericParams([['a', undefined], ['b', '  '], ['c', 'abc'], ['d', 'Infinity']])).toEqual({});
  });

  it('keeps zero and negative numbers', () => {
    expect(numericParams([['a', '0'], ['b', '-5']])).toEqual({ a: 0, b: -5 });
  });
});

describe('toCommand', () => {
  it('is just the script call when there are no params', () => {
    expect(toCommand('connection-flood', 'plain', {})).toBe(
      './scripts/run-experiment.sh connection-flood plain',
    );
  });

  it('appends the params after -- as --flag value, in order', () => {
    expect(toCommand('malformed-payload', 'secure', { mode: 'giant', 'size-bytes': 1000 })).toBe(
      './scripts/run-experiment.sh malformed-payload secure -- --mode giant --size-bytes 1000',
    );
  });

  it('works for injection', () => {
    expect(toCommand('injection', 'plain', { count: 5, interval: 0.1 })).toBe(
      './scripts/run-experiment.sh injection plain -- --count 5 --interval 0.1',
    );
  });
});
