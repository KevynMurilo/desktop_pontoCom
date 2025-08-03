export {};

declare global {
  interface Window {
    electronAPI: {
      onSyncRecebimentoProgresso: (callback: (data: { registrosSincronizados: number; totalRegistros: number }) => void) => void;
      getUltimoProgressoSync: () => Promise<{ registrosSincronizados: number; totalRegistros: number } | null>;
    };
    backendApi: {
      getApiBaseUrl: () => Promise<string>;
    };
    device: {
      getId: () => string;
    };
  }
}
