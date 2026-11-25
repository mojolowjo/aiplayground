// Last resort for finding this network's public address: ask a "what is my IP" service over HTTPS.
// Only used when the router has opened the port but will not say what its own public address is.
import { isIpv4 } from './upnp.js';

export const PUBLIC_IP_SERVICE = 'https://api.ipify.org';

// Resolves with { ip, source } or rejects with why not. The service must answer with the bare address.
export async function publicIp({ url = PUBLIC_IP_SERVICE, timeout = 4000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!isIpv4(text)) throw new Error('it did not answer with an address');
  return { ip: text, source: new URL(url).host };
}
