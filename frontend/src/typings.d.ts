export {};

declare global {
  interface Window {
    backendApi: {
      getApiBaseUrl: () => Promise<string>;
    };
    device: {
      getId: () => string;
    };
  }
}
