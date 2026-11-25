// UPnP client: search from every adapter, and resend a request the router drops.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import { discover, soap } from '../net/upnp.js';

// A stand-in router answering the search.
const ssdp = dgram.createSocket('udp4');
await new Promise(r => ssdp.bind(0, '127.0.0.1', r));
ssdp.on('message', (msg, from) => ssdp.send(Buffer.from('HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: http://127.0.0.1:1/desc.xml\r\n\r\n'), from.port, from.address));
const url = await discover({ to: { address: '127.0.0.1', port: ssdp.address().port }, bindTo: ['127.0.0.1'] });
assert.equal(url, 'http://127.0.0.1:1/desc.xml');
ssdp.close();

// A router that hangs up on the first request and answers the second.
let calls = 0;
const srv = http.createServer((req, res) => {
  calls++;
  if (calls === 1) { req.socket.destroy(); return; }
  res.end('<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>8.8.8.8</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const out = await soap({ controlUrl: `http://127.0.0.1:${srv.address().port}/ctl`, serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1' }, 'GetExternalIPAddress');
assert.equal(out.NewExternalIPAddress, '8.8.8.8');
assert.equal(calls, 2);
srv.close();
console.log('upnp tests passed');
