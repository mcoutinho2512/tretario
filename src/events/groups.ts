/**
 * Grupos do evento escolhíveis por jogadores (rodada 8) — tudo vem dos DADOS (`groups` em public/events/<evento>.json).
 * NEUTRALIDADE: um grupo só muda APARÊNCIA (camiseta nas cores do grupo, designs sugeridos para bandeira/cartaz/
 * faixa). Nenhum código decide nada por grupo específico: velocidade, acesso, veículos, interesse, prioridade e
 * qualidade são idênticos para todos (tests/groupNeutrality.test.ts). A escolha vale só para o evento atual
 * (EventMembership), não é atributo permanente da conta (docs/PRIVACY_ARCHITECTURE.md).
 */
import type { CharacterAppearance } from '../characters/bodyTypes';
import { DESIGN_BY_KEY, type Design, type DesignTarget } from '../social/designs';
import type { EventDef, Group } from './types';

/** grupo como a API devolve (GET /api/events/current) — só dados públicos de apresentação */
export interface PublicGroup {
  key: string;
  name: string;
  colors: string[];
  neutral: boolean;
  designKey: string | null;
  suggestedDesigns: string[];
}

export interface CurrentEventResponse {
  event: { id: string; name: string; category: string };
  groups: PublicGroup[];
  /** grupo do usuário neste evento (só com sessão) */
  membership: { eventId: string; groupKey: string } | null;
}

/** id do EventGroup no banco: "<eventId>:<chave do grupo>" */
export const groupRecordId = (eventId: string, key: string) => `${eventId}:${key}`;
export const groupKeyOf = (recordId: string) => recordId.slice(recordId.indexOf(':') + 1);

const HEX = /^#[0-9a-f]{6}$/i;

/** grupos escolhíveis do evento, na ordem dos dados */
export function joinableGroups(ev: Pick<EventDef, 'groups'> | null | undefined): PublicGroup[] {
  return (ev?.groups ?? []).filter((g) => g.joinable).map(publicGroup);
}

export function publicGroup(g: Group): PublicGroup {
  return {
    key: g.id, name: g.name, colors: g.colors.filter((c) => HEX.test(c)), neutral: !!g.neutral,
    designKey: g.designKey ?? null, suggestedDesigns: (g.suggestedDesigns ?? []).filter((k) => typeof k === 'string'),
  };
}

/** designs sugeridos do grupo que servem para um alvo (bandeira, cartaz, faixa, camisa) — nunca obrigatórios */
export function groupDesigns(g: PublicGroup, target: DesignTarget): Design[] {
  const keys = [g.designKey, ...g.suggestedDesigns].filter((k): k is string => !!k);
  const out: Design[] = [];
  for (const k of keys) {
    const d = DESIGN_BY_KEY.get(k);
    if (d && d.targets.includes(target) && !out.includes(d)) out.push(d);
  }
  return out;
}

/** camiseta nas cores do grupo (opcional): modelo camiseta lisa na cor principal; o resto do visual fica igual */
export function withGroupShirt(app: CharacterAppearance, g: PublicGroup): CharacterAppearance {
  const c = g.colors[0];
  if (!c) return app;
  return { ...app, topStyle: 'camiseta', top: parseInt(c.slice(1), 16), shirtDesign: 0 };
}
