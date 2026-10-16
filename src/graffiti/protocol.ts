/**
 * Mensagens da pichação/grafite (cliente ↔ servidor) — tipos compartilhados, sem dependências.
 *
 * cliente → servidor
 *   gf_new     { s: id da superfície, d: Uint8Array (conteúdo v1, src/graffiti/codec.ts), n: nonce }   (≤ 4 KB)
 *   gf_report  { i: id }
 *   gf_admin   { token, op: 'remove'|'hide'|'restore'|'list', i?: id }   (só com PV_ADMIN_TOKEN no servidor)
 * servidor → cliente
 *   gf_add     GfWire[]            grafites visíveis que entraram na área de interesse (ou acabaram de ser criados)
 *   gf_del     { i: id[], r }      saíram (r: 'aoi' | 'hidden' | 'removed' | 'expired' | 'evicted')
 *   gf_state   { i, st }           mudança de estado ainda visível (ACTIVE ↔ REPORTED)
 *   gf_res     { op, ok, n?, i?, r? }  resposta a gf_new / gf_report / gf_admin
 * O desenho em andamento é LOCAL: nenhum outro cliente recebe nada antes do gf_new validado.
 */

/** grafite como vai para os clientes (o id anônimo do autor NÃO sai do servidor) */
export interface GfWire {
  i: number;
  s: string;
  d: Uint8Array;
  /** nome de exibição do autor */
  a: string;
  /** criado em / expira em (ms epoch; 0 = permanente) */
  t: number;
  e: number;
  st: number;
  /** 1 = criado por este cliente */
  m?: 1;
}

export interface GfNewMsg { s: string; d: Uint8Array; n: number }
export interface GfRes { op: 'new' | 'report' | 'admin'; ok: boolean; n?: number; i?: number; r?: string; list?: unknown }
export type GfDelReason = 'aoi' | 'hidden' | 'removed' | 'expired' | 'evicted';
