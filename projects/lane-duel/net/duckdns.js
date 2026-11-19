// Optional DuckDNS updater: keeps a <name>.duckdns.org address pointing at this network's public IP.
// The token is a secret. It only ever goes into the request to duckdns.org, never into a log line.

// Accepts "myname" or "myname.duckdns.org"; returns the bare name, or null if it is not a valid one.
export function duckName(domain) {
  const name = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').replace(/\.duckdns\.org\.?$/, '');
  return /^[a-z0-9-]{1,63}$/.test(name) ? name : null;
}

// One update. Leaving `ip` empty tells DuckDNS to use the address the request came from.
// Resolves true on success; rejects with a message that never contains the token.
export async function updateDuck({ name, token, fetchImpl = fetch, timeout = 10000 }) {
  const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}&ip=`;
  let text;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    text = (await res.text()).trim();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(String(e && e.message || e).split(token).join('<token>').split(encodeURIComponent(token)).join('<token>'));
  }
  if (text !== 'OK') throw new Error('DuckDNS answered "' + text.slice(0, 20) + '" (check the domain and token)');
  return true;
}

// Update now and then every `every` seconds. Failures are logged and never thrown.
export function startDuck({ name, token, every = 300, log = console.log, fetchImpl = fetch }) {
  let ok = null;
  const tick = async () => {
    try { await updateDuck({ name, token, fetchImpl }); if (ok !== true) log(`DuckDNS: ${name}.duckdns.org now points at this network.`); ok = true; }
    catch (e) { if (ok !== false) log(`WARNING: DuckDNS update failed (${e.message}). Will keep trying every ${Math.round(every / 60)} min.`); ok = false; }
  };
  const timer = setInterval(tick, every * 1000); timer.unref();
  const first = tick();
  return { stop: () => clearInterval(timer), first };
}
