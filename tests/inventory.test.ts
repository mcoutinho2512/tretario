/**
 * Rodada 11 — INVENTÁRIO (puro): catálogo só com conteúdo REAL e categorias com conteúdo, estados/motivos de bloqueio,
 * filtros, slots e incompatibilidades (uma peça por slot, uma coisa na mão), acesso rápido (só gameplay, layout
 * saneado e local) e as regras que o servidor usa (aparência estrita, título).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildInventory, categoriesWithContent, equippedBySlot, filterItems, titleCatalog, supporterDesignIds, type InventoryContext } from '../src/inventory/catalog';
import { lockedAppearanceItems, planEquip, planUnequip, validateTitle } from '../src/inventory/equipRules';
import { DEFAULT_QUICKBAR, isActive, isQuickKey, pinQuick, sanitizeQuickbar, unpinQuick, loadQuickbar, saveQuickbar } from '../src/inventory/quickbar';
import { parseCatalog, matchesObjective } from '../src/progression/engine';
import { parseSupporterData } from '../src/supporters/data';
import { validateAppearance } from '../src/characters/validateAppearance';
import { DEFAULT_PLAYER_APPEARANCE, ACCESSORIES } from '../src/characters/bodyTypes';
import { stylesFor } from '../src/characters/garments';
import { DESIGNS, DESIGN_BY_ID, DESIGN_BY_KEY } from '../src/social/designs';
import { PROPS, PROP_BY_ID } from '../src/social/props';
import { validateProp, type ActionActor } from '../src/social/actionRules';
import type { QuickbarLayout } from '../src/inventory/types';

const rd = (f: string) => JSON.parse(readFileSync(`public/gameplay/${f}`, 'utf8'));
const cat = parseCatalog({ missions: rd('missions.json'), achievements: rd('achievements.json'), levels: rd('levels.json'), rewards: rd('rewards.json') });
const sup = parseSupporterData(rd('supporters.json')).data!;
const base = validateAppearance(DEFAULT_PLAYER_APPEARANCE.homem)!;
const ctx = (o: Partial<InventoryContext> = {}): InventoryContext => ({
  app: base, prop: 0, design: 0, ent: new Set(), carried: 0, freeCombat: false, titles: [], title: null,
  supporters: sup, supporter: null, progression: cat, seen: new Set(), ...o,
});
const count = (items: ReturnType<typeof buildInventory>, c: string) => items.filter((i) => i.category === c).length;

describe('catálogo do inventário', () => {
  const items = buildInventory(ctx());

  it('só categorias com conteúdo (sem COSMÉTICOS vazios), na ordem da interface', () => {
    expect(categoriesWithContent(items)).toEqual(['ROUPAS', 'ACESSORIOS', 'ITENS', 'MANIFESTACAO', 'BANDEIRAS', 'EQUIPAMENTOS', 'VEICULOS', 'TORCIDA', 'TITULOS']); // rodada 12: + VEÍCULOS
    expect(categoriesWithContent(buildInventory(ctx({ supporters: null, progression: null })))).not.toContain('TORCIDA');
  });

  it('quantidades REAIS saem dos registros (nada inventado)', () => {
    const supIds = supporterDesignIds(sup);
    const pieces = (['SHIRT', 'PANTS', 'SHOES', 'HAIR'] as const).reduce((n, s) => n + stylesFor('homem', s).length, 0);
    const shirts = DESIGNS.filter((d) => d.targets.includes('shirt') && !supIds.has(d.id)).length;
    expect(count(items, 'ROUPAS')).toBe(pieces + shirts);
    expect(count(items, 'ACESSORIOS')).toBe(ACCESSORIES.length - 1);
    expect(count(items, 'ITENS')).toBe(PROPS.filter((p) => p.category !== 'COMBAT_PROP' && !p.designSlot).length);
    expect(count(items, 'MANIFESTACAO')).toBe(PROPS.filter((p) => p.category !== 'COMBAT_PROP' && p.designSlot).length);
    expect(count(items, 'EQUIPAMENTOS')).toBe(PROPS.filter((p) => p.category === 'COMBAT_PROP').length);
    expect(count(items, 'BANDEIRAS')).toBe(DESIGNS.filter((d) => d.targets.some((t) => ['flag', 'sign', 'banner'].includes(t)) && !supIds.has(d.id)).length);
    expect(count(items, 'TORCIDA')).toBe(sup.groups.reduce((n, g) => n + 2 + g.flagSet.length + g.bannerSet.length, 0));
    expect(count(items, 'TITULOS')).toBe(titleCatalog(cat).length);
    expect(titleCatalog(cat).length).toBeGreaterThanOrEqual(3);
    // cada chave aponta para algo que existe
    for (const i of items) {
      const [pre, rest] = [i.key.split(':')[0], i.key.slice(i.key.indexOf(':') + 1)];
      if (pre === 'prop') expect(PROP_BY_ID.has(Number(rest))).toBe(true);
      if (pre === 'shirt') expect(DESIGN_BY_ID.get(Number(rest))?.targets).toContain('shirt');
      if (pre === 'design') expect(DESIGN_BY_KEY.has(rest)).toBe(true);
      if (pre === 'sup') expect(sup.groups.some((g) => g.id === rest)).toBe(true);
    }
    // peças dependem do corpo
    expect(count(buildInventory(ctx({ app: validateAppearance(DEFAULT_PLAYER_APPEARANCE.idoso)! })), 'ROUPAS')).toBe((['SHIRT', 'PANTS', 'SHOES', 'HAIR'] as const).reduce((n, s) => n + stylesFor('idoso', s).length, 0) + shirts);
  });

  it('bloqueados mostram o motivo da progressão (nunca preço) e liberam com o direito', () => {
    const s208 = items.find((i) => i.key === 'shirt:208')!;
    expect(s208).toMatchObject({ state: 'locked', lockedReason: 'Nível 3' });
    expect(items.find((i) => i.key === 'design:noite_na_avenida')!.lockedReason).toBe('Missão: ENTRE NO CLIMA');
    expect(items.find((i) => i.key === 'title:Boa de papo')!).toMatchObject({ state: 'locked', lockedReason: 'Conquista: BOA CONVERSA' });
    for (const i of items) if (i.lockedReason) expect(i.lockedReason).not.toMatch(/R\$|pix|compr|loja|preço/i);
    const open = buildInventory(ctx({ ent: new Set(['shirt:208']), titles: ['Boa de papo'] }));
    expect(open.find((i) => i.key === 'shirt:208')!.state).toBe('available');
    expect(open.find((i) => i.key === 'shirt:208')!.isNew).toBe(true); // liberado e ainda não visto
    expect(open.find((i) => i.key === 'shirt:200')!.isNew).toBe(false); // gratuito não é "novo"
    expect(buildInventory(ctx({ ent: new Set(['shirt:208']), seen: new Set(['shirt:208']) })).find((i) => i.key === 'shirt:208')!.isNew).toBe(false);
  });

  it('equipamentos de confronto: posse do servidor (ou freeCombatProps)', () => {
    expect(items.find((i) => i.key === 'prop:11')!.state).toBe('locked');
    expect(buildInventory(ctx({ carried: 11 })).find((i) => i.key === 'prop:11')!.state).toBe('available');
    expect(buildInventory(ctx({ carried: 11 })).find((i) => i.key === 'prop:12')!.state).toBe('locked');
    expect(buildInventory(ctx({ freeCombat: true })).filter((i) => i.category === 'EQUIPAMENTOS').every((i) => i.state === 'available')).toBe(true);
  });

  it('filtros TODOS / EQUIPADOS / DESBLOQUEADOS / NOVOS', () => {
    const it2 = buildInventory(ctx({ prop: 1, design: 1, ent: new Set(['design:mar_e_mata']), supporter: sup.groups[0].id }));
    expect(filterItems(it2, 'TODOS', 'ROUPAS').length).toBe(count(it2, 'ROUPAS'));
    const eq = filterItems(it2, 'EQUIPADOS');
    expect(eq.map((i) => i.key)).toEqual(expect.arrayContaining(['top:camiseta', 'bottom:jeans', 'shoes:tenis', 'prop:1', 'design:brasil', `sup:${sup.groups[0].id}`]));
    expect(filterItems(it2, 'DESBLOQUEADOS').every((i) => i.state !== 'locked')).toBe(true);
    expect(filterItems(it2, 'NOVOS').map((i) => i.key)).toEqual(['design:mar_e_mata']);
  });
});

describe('slots e incompatibilidades', () => {
  const st = { app: base, prop: 0, design: 0, neutralId: sup.neutralId };

  it('uma peça por slot (resumo do que está equipado)', () => {
    const items = buildInventory(ctx({ app: { ...base, topStyle: 'camiseta', shirtDesign: 200, accessory: 'bone' }, prop: 3, design: 4 }));
    const bySlot = equippedBySlot(items);
    expect(bySlot.TORSO?.key).toBe('shirt:200'); // a estampa vence a peça (é o que se vê)
    expect(bySlot.ACCESSORY?.key).toBe('acc:bone');
    expect(bySlot.HAND?.key).toBe('prop:3');
    for (const slot of ['LEGS', 'FEET', 'HEAD', 'ACCESSORY'] as const) expect(items.filter((i) => i.slot === slot && i.state === 'equipped').length).toBe(1);
  });

  it('camisa estampada veste a camiseta; outra parte de cima tira a estampa', () => {
    const p = planEquip('shirt:205', st);
    expect(p).toMatchObject({ kind: 'appearance', app: { topStyle: 'camiseta', shirtDesign: 205 } });
    const q = planEquip('top:polo', { ...st, app: (p as { app: typeof base }).app });
    expect(q).toMatchObject({ kind: 'appearance', app: { topStyle: 'polo', shirtDesign: 0 } });
    expect(validateAppearance((q as { app: typeof base }).app)!.shirtDesign).toBe(0);
    expect(planEquip('top:inexistente', st).kind).toBe('none');
  });

  it('um acessório por vez; desequipar não obriga a escolher outro', () => {
    const a = planEquip('acc:oculos', { ...st, app: { ...base, accessory: 'bone' } });
    expect(a).toMatchObject({ kind: 'appearance', app: { accessory: 'oculos' } });
    expect(planUnequip('acc:oculos', st)).toMatchObject({ kind: 'appearance', app: { accessory: 'nenhum' } });
    expect(planUnequip('shirt:205', st)).toMatchObject({ kind: 'appearance', app: { shirtDesign: 0 } });
    expect(planUnequip('top:polo', st)).toMatchObject({ kind: 'appearance', app: { topStyle: 'camiseta' } }); // volta à base
    expect(planUnequip(`sup:${sup.groups[1].id}`, st)).toEqual({ kind: 'supporter', group: sup.neutralId });
    expect(planUnequip('title:Boa de papo', st)).toEqual({ kind: 'title', title: null });
  });

  it('a MÃO é uma só: segurável e item de confronto disputam o slot (o anterior sai)', () => {
    expect(planEquip('prop:1', { ...st, prop: 11 })).toEqual({ kind: 'prop', prop: 1 });
    expect(planEquip('prop:11', { ...st, prop: 3, design: 4 })).toEqual({ kind: 'prop', prop: 11 });
    // arte: troca só a arte se o item na mão aceita; senão pega o primeiro item que aceita
    expect(planEquip('design:paz', { ...st, prop: 3, design: 4 })).toEqual({ kind: 'prop', prop: 3, design: DESIGN_BY_KEY.get('paz')!.id });
    const banner = DESIGNS.find((d) => d.targets.length === 1 && d.targets[0] === 'banner')!;
    expect(planEquip(`design:${banner.key}`, { ...st, prop: 1 })).toEqual({ kind: 'prop', prop: PROPS.find((p) => p.designSlot === 'banner')!.id, design: banner.id });
    expect(planUnequip('prop:1', { ...st, prop: 1 })).toEqual({ kind: 'prop', prop: 0 });
    expect(isActive('prop:1', 1, 0)).toBe(true);
    expect(isActive('prop:1', 3, 0)).toBe(false);
    expect(isActive('design:paz', 3, DESIGN_BY_KEY.get('paz')!.id)).toBe(true);
    expect(isActive('design:paz', 7, DESIGN_BY_KEY.get('paz')!.id)).toBe(false);
  });

  it('servidor: item de confronto sem posse e design bloqueado são recusados (validateProp)', () => {
    const actor = (o: Partial<ActionActor> = {}): ActionActor => ({ act: 0, actAt: 0, prop: 0, design: 0, status: 0, vehicle: '', recent: [], ent: { items: new Set() }, ...o });
    expect(validateProp(actor(), 11, 0, 1000)).toEqual({ ok: false, reason: 'sem_item' });
    expect(validateProp(actor({ carried: 11 }), 11, 0, 1000)).toEqual({ ok: true });
    expect(validateProp(actor({ freeCombat: true }), 12, 0, 1000)).toEqual({ ok: true });
    expect(validateProp(actor(), 1, DESIGN_BY_KEY.get('mar_e_mata')!.id, 1000)).toEqual({ ok: false, reason: 'bloqueado' });
    expect(validateProp(actor({ ent: { items: new Set(['design:mar_e_mata']) } }), 1, DESIGN_BY_KEY.get('mar_e_mata')!.id, 1000)).toEqual({ ok: true });
  });

  it('servidor: aparência ESTRITA lista o bloqueado; título só os ganhos', () => {
    expect(lockedAppearanceItems({ ...base, topStyle: 'camiseta', shirtDesign: 208 }, { items: new Set() })).toEqual(['shirt:208']);
    expect(lockedAppearanceItems({ ...base, topStyle: 'camiseta', shirtDesign: 208 }, { items: new Set(['shirt:208']) })).toEqual([]);
    expect(lockedAppearanceItems({ ...base, accessory: 'bone', topStyle: 'polo', shirtDesign: 200 }, { items: new Set() })).toEqual([]);
    expect(lockedAppearanceItems('lixo', { items: new Set() })).toEqual([]);
    expect(validateTitle(['Boa de papo'], 'Boa de papo')).toEqual({ ok: true, title: 'Boa de papo' });
    expect(validateTitle(['Boa de papo'], 'Conhece a avenida')).toEqual({ ok: false, reason: 'bloqueado' });
    expect(validateTitle([], null)).toEqual({ ok: true, title: null });
    expect(validateTitle([], { t: 1 })).toEqual({ ok: false, reason: 'invalido' });
    expect(validateTitle(['x'.repeat(60)], 'x'.repeat(60))).toEqual({ ok: false, reason: 'invalido' });
  });
});

describe('acesso rápido 1–5', () => {
  const items = buildInventory(ctx({ ent: new Set(['design:mar_e_mata']) }));
  const get = (k: string) => items.find((i) => i.key === k)!;

  it('só itens de gameplay (seguráveis, confronto e artes de mão) — nunca roupa', () => {
    expect(items.filter((i) => i.quickbar).every((i) => i.slot === 'HAND' || i.slot === 'VEHICLE')).toBe(true); // rodada 12: + veículo pessoal
    expect(items.filter((i) => i.category === 'ROUPAS' || i.category === 'ACESSORIOS' || i.category === 'TITULOS').some((i) => i.quickbar)).toBe(false);
    expect(isQuickKey('prop:1')).toBe(true);
    expect(isQuickKey('design:paz')).toBe(true);
    expect(isQuickKey('shirt:200')).toBe(false);
    expect(isQuickKey('acc:bone')).toBe(false);
    expect(isQuickKey('prop:99')).toBe(false);
    const l = [...DEFAULT_QUICKBAR] as QuickbarLayout;
    expect(pinQuick(l, get('shirt:200'), 3)).toMatchObject({ ok: false, layout: l });
  });

  it('fixar: primeiro vazio, índice escolhido, sem repetir; desafixar', () => {
    let l = [...DEFAULT_QUICKBAR] as QuickbarLayout;
    let r = pinQuick(l, get('prop:11'));
    expect(r).toMatchObject({ ok: true, index: 3 });
    l = r.layout;
    r = pinQuick(l, get('prop:11'), 0); // mover: sai do 4, vai para o 1
    expect(r.layout).toEqual(['prop:11', 'prop:3', 'prop:7', null, null]);
    l = pinQuick(pinQuick(r.layout, get('prop:12')).layout, get('prop:13')).layout;
    expect(l).toEqual(['prop:11', 'prop:3', 'prop:7', 'prop:12', 'prop:13']);
    expect(pinQuick(l, get('design:mar_e_mata')).layout[4]).toBe('design:mar_e_mata'); // cheio: o último
    expect(unpinQuick(l, 1)[1]).toBeNull();
  });

  it('layout local saneado (lixo, repetição, roupa) e armazenamento que falha não quebra', () => {
    expect(sanitizeQuickbar(['prop:1', 'prop:1', 'shirt:200', 42, 'design:paz', 'prop:2'])).toEqual(['prop:1', null, null, null, 'design:paz']);
    expect(sanitizeQuickbar('x')).toEqual([null, null, null, null, null]);
    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(loadQuickbar()).toEqual(DEFAULT_QUICKBAR);
    expect(() => saveQuickbar(['prop:2', null, null, null, null])).not.toThrow();
    const mem = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    saveQuickbar(['prop:2', 'prop:9', null, null, null]);
    expect(loadQuickbar()).toEqual(['prop:2', 'prop:9', null, null, null]);
    g.localStorage = prev;
  });

  it('missões: bandeira/cartaz pelo acesso rápido viram o MESMO pedido `prop` que conta no servidor', () => {
    const flag = planEquip('prop:1', { app: base, prop: 0, design: 0 }) as { kind: 'prop'; prop: number };
    const sign = planEquip('design:paz', { app: base, prop: 0, design: 0 }) as { kind: 'prop'; prop: number };
    const ev = (id: number) => { const p = PROP_BY_ID.get(id)!; return { type: 'prop' as const, kind: p.kind, ...(p.designSlot ? { slot: p.designSlot } : {}) }; };
    const obj = (m: string, o: string) => cat.missions.find((x) => x.id === m)!.objectives.find((x) => x.id === o)!;
    expect(matchesObjective(obj('entre_no_clima', 'bandeira'), ev(flag.prop))).toBe(true);
    // a arte "paz" vai primeiro na bandeira (primeiro item que aceita); um cartaz fixado conta para VOZ NA AVENIDA
    expect(matchesObjective(obj('voz_na_avenida', 'cartaz'), ev((planEquip('prop:3', { app: base, prop: 0, design: 0 }) as { prop: number }).prop))).toBe(true);
    expect(matchesObjective(obj('voz_na_avenida', 'cartaz'), ev((planEquip('design:paz', { app: base, prop: 3, design: 4 }) as { prop: number }).prop))).toBe(true);
    expect(sign.prop).toBeGreaterThan(0);
  });
});
