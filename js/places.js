// Localização do aparelho e busca de estabelecimentos próximos no OpenStreetMap (API Overpass).
// A posição só é enviada ao Overpass quando o usuário toca em "buscar lugares".

import { parseOverpassPlaces } from './core.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const SEARCH_RADIUS = 150; // metros
const cache = new Map();

export function isSupported() {
  return 'geolocation' in navigator;
}

export function getPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!isSupported()) return reject(new Error('Localização não suportada neste aparelho.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(
        err.code === err.PERMISSION_DENIED
          ? 'Permissão de localização negada. Libere nas configurações do navegador/celular.'
          : err.code === err.TIMEOUT
            ? 'Não foi possível obter a localização a tempo. Tente de novo.'
            : 'Localização indisponível no momento.',
      )),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

function buildQuery({ lat, lon }, radius) {
  const around = `around:${radius},${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `[out:json][timeout:10];nwr(${around})["name"][~"^(amenity|shop|leisure|tourism|healthcare)$"~"."];out center tags 40;`;
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Estabelecimentos com nome num raio de ~150 m, do mais perto ao mais longe.
export async function searchNearby(origin, radius = SEARCH_RADIUS) {
  // Posições a ~10 m uma da outra reaproveitam o mesmo resultado.
  const key = `${origin.lat.toFixed(4)},${origin.lon.toFixed(4)},${radius}`;
  if (cache.has(key)) return cache.get(key);
  if (!navigator.onLine) throw new Error('Sem internet para buscar lugares. Digite o nome do local.');

  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(buildQuery(origin, radius))}`,
      }, 12000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const places = parseOverpassPlaces(await res.json(), origin).slice(0, 15);
      cache.set(key, places);
      return places;
    } catch (err) {
      lastError = err;
    }
  }
  console.warn('Busca de lugares falhou', lastError);
  throw new Error('O serviço de mapas não respondeu. Tente de novo ou digite o nome do local.');
}
