/**
 * Registro de runners por FORMATO (rodada 9): o EventRuntime cria um runner por instância a partir daqui — nunca
 * `if (evento === …)`. Formato sem runner registrado: a instância segue a agenda (estados/inscrição) sem lógica própria.
 * Dados obrigatórios ausentes (ex.: corrida sem `race`): sem runner, a instância só aparece na agenda.
 */
import type { RunnerFactory } from './runner';
import { WalkRunner } from './WalkRunner';
import { RaceRunner } from './RaceRunner';
import { ClashRunner } from './ClashRunner';

export const RUNNERS = new Map<string, RunnerFactory>();

RUNNERS.set('caminhada', (d) => (d.walk ? new WalkRunner(d.npcCrowd ?? 0, d.walk) : null));
RUNNERS.set('corrida', (d) => (d.race ? new RaceRunner(d.npcCrowd ?? 0, d.race) : null));
RUNNERS.set('confronto_grupos', (d) => (d.clash ? new ClashRunner(d.clash, d.groupRules?.allowed ?? [], d.groupRules?.friendlyFire ?? false) : null));
