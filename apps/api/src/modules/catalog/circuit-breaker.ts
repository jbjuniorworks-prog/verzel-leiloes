export class CircuitOpenError extends Error {
  constructor() {
    super('Circuito aberto: a API externa falhou várias vezes seguidas e está em pausa.');
    this.name = 'CircuitOpenError';
  }
}

export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Depois de N falhas seguidas, para de chamar a API por um tempo (circuito aberto)
 * e responde direto do cache. Assim uma API fora do ar não deixa cada busca
 * esperando timeout. Passado o cooldown, uma chamada de teste decide se fecha.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 30_000,
  ) {}

  get state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return Date.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  /** `isFailure` permite ignorar erros que não indicam API doente (ex.: busca inválida). */
  async run<T>(operation: () => Promise<T>, isFailure: (error: unknown) => boolean = () => true): Promise<T> {
    if (this.state === 'open') throw new CircuitOpenError();
    try {
      const result = await operation();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (error) {
      if (!isFailure(error)) throw error;
      this.failures++;
      if (this.state === 'half-open' || this.failures >= this.threshold) this.openedAt = Date.now();
      throw error;
    }
  }

  reset() {
    this.failures = 0;
    this.openedAt = null;
  }
}
