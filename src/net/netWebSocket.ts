/**
 * WebSocket instrumentado (cliente) — DEVE ser importado antes do @colyseus/sdk, que captura
 * `globalThis.WebSocket` ao carregar.
 *  - conta bytes/mensagens recebidos e enviados (painel F3, testes de consumo de rede)
 *  - simula rede adversa no navegador: ?lag=ms (ida e volta) e ?jitter=ms — preservando a ORDEM
 *    das mensagens (como o TCP faz: jitter vira atraso em bloco, não reordenação).
 *    Perda de pacotes só é simulável no servidor (PV_LOSS), em mensagens toleráveis (movimento/trânsito),
 *    porque o WebSocket é confiável e os patches de estado não podem ser perdidos.
 */
export const netStats = { bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0, opened: 0, sendsScheduled: 0, sendsDone: 0, sendsDropped: 0 };
(globalThis as { __pvNetStats?: unknown }).__pvNetStats = netStats;

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const SIM = { lag: Number(q.get('lag') ?? 0), jitter: Number(q.get('jitter') ?? 0) };

const Native = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
if (Native && !(Native as unknown as { __pvInstrumented?: boolean }).__pvInstrumented) {
  const delay = () => SIM.lag / 2 + Math.random() * SIM.jitter;
  class PVWebSocket extends Native {
    static __pvInstrumented = true;
    private lastOut = 0;
    private lastIn = 0;
    private userOnMessage: ((ev: MessageEvent) => void) | null = null;

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      netStats.opened++;
      this.addEventListener('close', (e) => { (netStats as Record<string, unknown>).closeCode = e.code; (netStats as Record<string, unknown>).closeReason = e.reason; (netStats as Record<string, unknown>).closeAtMsgs = netStats.msgsIn; });
      super.onmessage = (ev: MessageEvent) => {
        const d = ev.data as ArrayBuffer | string;
        netStats.bytesIn += typeof d === 'string' ? d.length : d.byteLength;
        netStats.msgsIn++;
        if (!SIM.lag && !SIM.jitter) { this.userOnMessage?.(ev); return; }
        const due = Math.max(performance.now() + delay(), this.lastIn);
        this.lastIn = due;
        setTimeout(() => this.userOnMessage?.(ev), due - performance.now());
      };
    }

    // o SDK atribui `ws.onmessage = …`
    set onmessage(fn: ((ev: MessageEvent) => void) | null) { this.userOnMessage = fn; }
    get onmessage() { return this.userOnMessage; }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      const n = typeof data === 'string' ? data.length : (data as ArrayBuffer).byteLength ?? 0;
      netStats.bytesOut += n;
      netStats.msgsOut++;
      if (!SIM.lag && !SIM.jitter) return super.send(data);
      const due = Math.max(performance.now() + delay(), this.lastOut);
      this.lastOut = due;
      // o SDK reutiliza o buffer de codificação: copiar ANTES de atrasar o envio (senão vai conteúdo sobrescrito)
      if (ArrayBuffer.isView(data)) data = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      else if (data instanceof ArrayBuffer) data = data.slice(0);
      netStats.sendsScheduled++;
      setTimeout(() => { if (this.readyState === 1) { super.send(data); netStats.sendsDone++; } else netStats.sendsDropped++; }, due - performance.now());
    }
  }
  (globalThis as { WebSocket: unknown }).WebSocket = PVWebSocket;
}
