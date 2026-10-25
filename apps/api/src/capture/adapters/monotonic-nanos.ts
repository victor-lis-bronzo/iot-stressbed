/**
 * Um ponto do InfluxDB é único por (measurement, tags, timestamp): escrever de
 * novo na mesma série com o mesmo timestamp SOBRESCREVE o ponto anterior. Com
 * precisão de milissegundo e as tags constantes de uma run, num flood várias
 * mensagens caíam no mesmo milissegundo e só a última sobrevivia (ADR-0011).
 *
 * O gerador devolve o timestamp em nanossegundos (como string, porque passa de
 * 2^53) e garante que ele é estritamente crescente: se a leitura do relógio não
 * avançou, soma 1 ns ao anterior. Isso dá unicidade sem acrescentar uma tag
 * (`seq` explodiria a cardinalidade das séries).
 */
export function createMonotonicNanos(): (at: Date) => string {
  let last = 0n;
  return (at) => {
    const ns = BigInt(at.getTime()) * 1_000_000n;
    last = ns > last ? ns : last + 1n;
    return last.toString();
  };
}
