/**
 * Registro de runners por FORMATO (rodada 9): o EventRuntime cria um runner por instância a partir daqui — nunca
 * `if (evento === …)`. Formato sem runner registrado: a instância segue a agenda (estados/inscrição) sem lógica própria.
 */
import type { RunnerFactory } from './runner.ts';

export const RUNNERS = new Map<string, RunnerFactory>();
