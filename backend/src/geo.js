import axios from 'axios';

const FALLBACK_COORDENADAS = { latitude: -15.5390, longitude: -47.3347 }; // Formosa - GO

const providers = [
  'https://ipapi.co/json/',
  'https://ipwho.is/'
];

export async function getLocationByIP() {
  for (const url of providers) {
    try {
      const { data } = await axios.get(url);

      const latitude = data.latitude ?? data.lat;
      const longitude = data.longitude ?? data.lon;

      if (latitude && longitude) {
        return { latitude, longitude };
      }
    } catch (err) {
      console.warn(`[!] Falha ao obter localização de ${url}:`, err.message);
    }
  }

  console.warn('[!] Todos os provedores falharam. Usando fallback: Formosa - GO');
  return FALLBACK_COORDENADAS;
}
