export const VERSION = '2.0.0';

export const PROVIDERS = {
  RKL:             { name: 'Klang Valley', operator: 'RapidKL',          center: [3.139, 101.687],   zoom: 11 },
  'RKL-PUTRAJAYA': { name: 'Putrajaya',    operator: 'RapidKL Putrajaya', center: [2.9264, 101.6964], zoom: 13 },
  RPG:             { name: 'Penang',       operator: 'Rapid Penang',      center: [5.39, 100.31],     zoom: 12 },
  RKN:             { name: 'Kuantan',      operator: 'Rapid Kuantan',     center: [3.81, 103.33],     zoom: 12 },
};
// The bundled GTFS stop data only covers RapidKL.
export const HAS_STATIC = new Set(['RKL', 'RKL-PUTRAJAYA']);

export const POLL_ROUTE_MS = 6000;    // one route: small payload, feels live
export const POLL_NETWORK_MS = 12000; // every bus in the city: bigger payload
export const SIGNAL_STALE_S = 300;    // no GPS update for 5 min -> shown grey
export const MOVING_KMH = 3;

export const TILES = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: '',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  },
};
