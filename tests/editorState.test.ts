/**
 * Rodada 11 — estado do editor de personagem (lógica pura de src/ui/editor/editorState.ts): abas/categorias,
 * escolhas, desfazer/refazer/restaurar, cadeados com o motivo da progressão e "vestir as cores" da torcida nos 4 corpos.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EDITOR_TABS, TAB_IDS, EditorHistory, changedTabs, itemKey, lockInfo, pickAccessory, pickBody, pickColor, pickDesign, pickStyle,
  sameSnapshot, tabOfField, wearOutfit, type EditorSnapshot,
} from '../src/ui/editor/editorState';
import { DEFAULT_PLAYER_APPEARANCE, HAIR_OLD, type BodyType, type CharacterAppearance } from '../src/characters/bodyTypes';
import { validateAppearance } from '../src/characters/validateAppearance';
import { ITEM_TIERS } from '../src/characters/unlocks';
import { DESIGNS, DESIGN_BY_ID } from '../src/social/designs';
import { parseSupporterData, supporterOutfit } from '../src/supporters/data';

const BODIES: BodyType[] = ['homem', 'mulher', 'idoso', 'idosa'];
const base = (b: BodyType = 'homem'): CharacterAppearance => validateAppearance(DEFAULT_PLAYER_APPEARANCE[b])!;
const snap = (app: CharacterAppearance, sup: string | null = null): EditorSnapshot => ({ app, sup });

describe('abas e categorias', () => {
  it('as 7 categorias do editor de jogo, na ordem da interface', () => {
    expect(TAB_IDS).toEqual(['CORPO', 'CABELO', 'CAMISA', 'CALCA', 'CALCADO', 'ACESSORIOS', 'TORCIDA']);
  });
  it('cada campo da aparência tem exatamente uma aba e cada aba edita algo', () => {
    const fields: (keyof CharacterAppearance)[] = ['body', 'skin', 'hair', 'hairStyle', 'top', 'topStyle', 'shirtDesign', 'bottom', 'bottomStyle', 'shoes', 'shoeStyle', 'accessory', 'acc'];
    for (const f of fields) expect(tabOfField(f), f).not.toBeNull();
    for (const t of EDITOR_TABS) expect(t.sections.length, t.id).toBeGreaterThan(0);
    expect(tabOfField('shirtDesign')).toBe('CAMISA');
    expect(tabOfField('acc')).toBe('ACESSORIOS');
    // cada camada de roupa (estilo) aparece numa aba só
    const slots = EDITOR_TABS.flatMap((t) => t.sections.filter((s) => s.kind === 'style').map((s) => (s as { slot: string }).slot));
    expect(slots.sort()).toEqual(['HAIR', 'PANTS', 'SHIRT', 'SHOES']);
    const colors = EDITOR_TABS.flatMap((t) => t.sections.filter((s) => s.kind === 'color').map((s) => (s as { key: string }).key));
    expect(colors.sort()).toEqual(['acc', 'bottom', 'hair', 'shoes', 'skin', 'top']);
    expect(EDITOR_TABS.find((t) => t.id === 'TORCIDA')!.sections).toEqual([{ kind: 'supporter' }]);
  });
  it('abas alteradas em relação ao salvo (inclui a torcida)', () => {
    const a = base();
    const b = pickColor(pickStyle(a, 'PANTS', 'bermuda'), 'hair', 0x141414);
    expect([...changedTabs(snap(b, 'x'), snap(a))].sort()).toEqual(['CABELO', 'CALCA', 'TORCIDA']);
    expect(changedTabs(snap(a), snap({ ...a })).size).toBe(0);
  });
});

describe('escolhas (mesmas regras do editor anterior)', () => {
  it('cor lisa na camisa tira a camisa de futebol; modelo diferente de camiseta também', () => {
    const d = DESIGNS.find((x) => x.targets.includes('shirt') && !ITEM_TIERS[`shirt:${x.id}`])!;
    const withShirt = pickDesign(base(), d);
    expect(withShirt).toMatchObject({ shirtDesign: d.id, topStyle: 'camiseta', top: parseInt(d.palette.bg.slice(1), 16) });
    expect(pickColor(withShirt, 'top', 0xd23c3c).shirtDesign).toBe(0);
    expect(pickColor(withShirt, 'bottom', 0x1f2430).shirtDesign).toBe(d.id);
    expect(pickStyle(withShirt, 'SHIRT', 'polo').shirtDesign).toBe(0);
    expect(pickStyle(withShirt, 'SHIRT', 'camiseta').shirtDesign).toBe(d.id);
    expect(pickDesign(withShirt, null).shirtDesign).toBe(0);
  });
  it('trocar de corpo mantém o visual e ajusta o cabelo à idade', () => {
    const young = { ...base('homem'), hair: 0x1c1410 };
    const old = pickBody(young, 'idoso');
    expect(old.body).toBe('idoso');
    expect(HAIR_OLD).toContain(old.hair);
    expect(old.top).toBe(young.top);
    expect(pickBody(old, 'idosa').hair).toBe(old.hair); // continua velho → cabelo mantido
  });
  it('acessório e o validador do servidor', () => {
    const a = pickAccessory(base(), 'oculos');
    expect(validateAppearance(a)!.accessory).toBe('oculos');
    expect(validateAppearance(pickStyle(base('homem'), 'HAIR', 'chanel'))!.hairStyle).not.toBe('chanel'); // homem não tem chanel
  });
});

describe('desfazer / refazer / restaurar', () => {
  it('pilha linear; nova edição apaga o refazer; igual não cresce', () => {
    const a = base();
    const h = new EditorHistory(snap(a));
    expect(h.canUndo || h.canRedo || h.dirty).toBe(false);
    const b = pickColor(a, 'top', 0xd23c3c), c = pickStyle(b, 'SHOES', 'chinelo');
    expect(h.push(snap(b))).toBe(true);
    expect(h.push(snap({ ...b }))).toBe(false);
    h.push(snap(c));
    expect(h.dirty).toBe(true);
    expect(h.undo()).toBe(true);
    expect(sameSnapshot(h.current, snap(b))).toBe(true);
    expect(h.canRedo).toBe(true);
    h.redo();
    expect(sameSnapshot(h.current, snap(c))).toBe(true);
    h.undo(); h.undo();
    expect(sameSnapshot(h.current, snap(a))).toBe(true);
    expect(h.dirty).toBe(false);
    expect(h.undo()).toBe(false);
    h.push(snap(pickAccessory(a, 'bone')));
    expect(h.canRedo).toBe(false);
  });
  it('restaurar volta ao SALVO e pode ser desfeito; salvar vira a nova referência', () => {
    const saved = base('mulher');
    const h = new EditorHistory(snap(saved), snap(saved));
    const x = pickColor(saved, 'skin', 0x6b3f26);
    h.push(snap(x, 'grupo'));
    expect(h.canRestore).toBe(true);
    expect(h.restore()).toBe(true);
    expect(sameSnapshot(h.current, snap(saved))).toBe(true);
    expect(h.canRestore).toBe(false);
    h.undo();
    expect(sameSnapshot(h.current, snap(x, 'grupo'))).toBe(true);
    // o servidor pode ajustar o que aceitou
    const accepted = snap({ ...x, accessory: 'nenhum' }, 'grupo');
    h.markSaved(accepted);
    expect(h.dirty).toBe(false);
    expect(sameSnapshot(h.savedState, accepted)).toBe(true);
  });
  it('limite do histórico', () => {
    const h = new EditorHistory(snap(base()));
    for (let i = 0; i < EditorHistory.MAX + 25; i++) h.push(snap(pickColor(base(), 'top', i + 1)));
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(EditorHistory.MAX);
  });
  it('reset ao reabrir', () => {
    const h = new EditorHistory(snap(base()));
    h.push(snap(pickColor(base(), 'top', 5)));
    h.reset(snap(base('idosa')));
    expect(h.canUndo).toBe(false);
    expect(h.current.app.body).toBe('idosa');
  });
});

describe('cadeados (progressão, sem loja)', () => {
  const locked = Object.keys(ITEM_TIERS).find((k) => k.startsWith('shirt:'))!;
  it('item gratuito nunca tem cadeado', () => {
    expect(lockInfo(itemKey({ kind: 'style', slot: 'SHIRT', style: 'polo' }), {}, () => 'x')).toEqual({ locked: false, reason: '' });
    expect(itemKey({ kind: 'accessory', acc: 'bone' })).toBe('acc:bone');
    expect(itemKey({ kind: 'style', slot: 'PANTS', style: 'bermuda' })).toBe('bottom:bermuda');
    expect(itemKey({ kind: 'design', id: 208 })).toBe('shirt:208');
  });
  it('bloqueado mostra o motivo da progressão; liberado pelo direito some o cadeado', () => {
    const li = lockInfo(locked as `shirt:${number}`, {}, (i) => (i === locked ? 'Nível 4' : null));
    expect(li).toEqual({ locked: true, reason: 'Nível 4' });
    expect(lockInfo(locked as `shirt:${number}`, {}, () => null).reason).toBe('Liberado por progressão');
    expect(lockInfo(locked as `shirt:${number}`, { items: new Set([locked]) }, () => 'Nível 4').locked).toBe(false);
  });
  it('o validador descarta o item bloqueado (o que se salva é o que o servidor aceita)', () => {
    const id = Number(locked.split(':')[1]);
    const d = DESIGN_BY_ID.get(id)!;
    expect(validateAppearance(pickDesign(base(), d))!.shirtDesign).toBe(0);
    expect(validateAppearance(pickDesign(base(), d), null, { items: new Set([locked]) })!.shirtDesign).toBe(id);
  });
});

describe('torcida: "vestir as cores" nos 4 corpos', () => {
  const data = parseSupporterData(JSON.parse(readFileSync('public/gameplay/supporters.json', 'utf8'))).data!;
  it('camisa da torcida (design) e cores sugeridas aceitas pelo validador em todos os corpos', () => {
    expect(data.groups.length).toBeGreaterThan(0);
    for (const g of data.groups) {
      for (const b of BODIES) {
        const start = pickStyle(base(b), 'SHIRT', b.startsWith('idos') ? 'polo' : 'regata');
        const a = validateAppearance(wearOutfit(start, supporterOutfit(g)))!;
        expect(a.topStyle, `${g.id}/${b}`).toBe('camiseta');
        expect(a.shirtDesign, `${g.id}/${b}`).toBe(g.clothingSet.shirtDesign);
        expect(a.body).toBe(b);
        // só camisa/cores sugeridas mudam: corpo, pele, cabelo, acessório ficam
        expect({ skin: a.skin, hair: a.hair, hairStyle: a.hairStyle, accessory: a.accessory }).toEqual({ skin: start.skin, hair: start.hair, hairStyle: start.hairStyle, accessory: start.accessory });
      }
    }
  });
});
