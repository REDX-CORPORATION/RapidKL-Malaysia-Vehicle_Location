const zlib = require('zlib');
const crypto = require('crypto');
const { io: ioClient } = require('socket.io-client');

const UPSTREAM = process.env.UPSTREAM_SOCKET || 'https://rapidbus-socketio-avl.prasarana.com.my';

function decompress(payload) {
  return JSON.parse(zlib.gunzipSync(Buffer.from(payload, 'base64')).toString('utf8'));
}

/** Opens a short-lived socket, asks for the provider's full feed once, resolves with it (or null on failure). */
function fetchBuses(provider, timeoutMs = 4500) {
  return new Promise((resolve) => {
    const sid = crypto.randomUUID().replace(/-/g, '');
    let settled = false;
    let sock;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (sock) sock.disconnect(); } catch (_) {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock = ioClient(UPSTREAM, { transports: ['websocket'], reconnection: false, timeout: 3500, forceNew: true });
    sock.on('connect', () => sock.emit('onFts-reload', { sid, uid: '', provider, route: '' }));
    sock.on('onFts-client', (payload) => { try { finish(decompress(payload)); } catch (_) { finish(null); } });
    sock.on('connect_error', () => finish(null));
  });
}

module.exports = { fetchBuses, decompress };
