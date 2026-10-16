/**
 * Persistência dos grafites atrás de uma INTERFACE (GraffitiStore): em desenvolvimento, um arquivo JSON local
 * (server/data/graffiti.json, fora do git); trocar por um banco depois = nova implementação desta interface,
 * sem mexer no serviço. Nada de serviço externo aqui.
 *
 * Gravação: debounced (PV_GRAFFITI_SAVE_MS, 2 s) e atômica (arquivo temporário + rename) — uma queda no meio
 * da escrita não corrompe o arquivo. `flush()` grava já (ao fechar a sala).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** registro persistido (identidade do autor: sessão + nome + id anônimo do aparelho — identidade real virá com login) */
export interface StoredGraffiti {
  id: number;
  surface: string;
  author: { sessionId: string; name: string; clientId: string };
  rect: { s: number; t: number; w: number; h: number };
  /** conteúdo vetorial v1 (src/graffiti/codec.ts) em base64 */
  content: string;
  createdAt: number;
  /** 0 = permanente (superfície autorizada) */
  expiresAt: number;
  state: number;
  reports: string[];
  persistence: 'permanent' | 'temporary';
  /** contém texto (caminho moderável) */
  hasText?: boolean;
}

export interface GraffitiStore {
  /** carrega tudo (assíncrono para caber um banco depois) */
  load(): Promise<{ records: StoredGraffiti[]; nextId: number }>;
  put(rec: StoredGraffiti, nextId: number): void;
  delete(id: number): void;
  flush(): Promise<void>;
}

/** só memória (testes, PV_GRAFFITI_STORE=memory) */
export class MemoryGraffitiStore implements GraffitiStore {
  readonly map = new Map<number, StoredGraffiti>();
  nextId = 1;
  async load() { return { records: [...this.map.values()].map((r) => structuredClone(r)), nextId: this.nextId }; }
  put(rec: StoredGraffiti, nextId: number) { this.map.set(rec.id, structuredClone(rec)); this.nextId = nextId; }
  delete(id: number) { this.map.delete(id); }
  async flush() {}
}

export class JsonFileGraffitiStore implements GraffitiStore {
  private map = new Map<number, StoredGraffiti>();
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  writes = 0;

  constructor(readonly file: string, private debounceMs = Number(process.env.PV_GRAFFITI_SAVE_MS ?? 2000)) {}

  async load() {
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { version?: number; nextId?: number; records?: StoredGraffiti[] };
        for (const r of raw.records ?? []) if (Number.isInteger(r?.id) && typeof r.content === 'string') this.map.set(r.id, r);
        this.nextId = Math.max(Number(raw.nextId) || 1, ...[...this.map.keys()].map((k) => k + 1));
      } catch (e) {
        // arquivo ilegível: guarda uma cópia para análise e começa vazio (nunca derruba o servidor)
        console.warn(`[graffiti] ${this.file} ilegível (${(e as Error).message}); copiado para .bad`);
        try { renameSync(this.file, `${this.file}.bad`); } catch { /* */ }
      }
    }
    return { records: [...this.map.values()], nextId: this.nextId };
  }

  put(rec: StoredGraffiti, nextId: number) { this.map.set(rec.id, rec); this.nextId = Math.max(this.nextId, nextId); this.schedule(); }
  delete(id: number) { if (this.map.delete(id)) this.schedule(); }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.writeNow(); }, this.debounceMs);
    this.timer.unref?.();
  }

  private writeNow() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, nextId: this.nextId, savedAt: Date.now(), records: [...this.map.values()] }));
    renameSync(tmp, this.file);
    this.writes++;
  }

  async flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.writeNow();
  }
}
