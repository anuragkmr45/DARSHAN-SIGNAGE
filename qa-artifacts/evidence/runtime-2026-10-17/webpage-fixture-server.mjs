import http from 'node:http';

let version = 1;
let failPage = false;
let authorizationHeaderCount = 0;
let secretRequestCount = 0;

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'cache-control': 'no-store', ...headers });
  response.end(body);
};

http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture.invalid');

  if (url.pathname === '/control') {
    if (url.searchParams.has('version')) version = Number(url.searchParams.get('version')) || version;
    if (url.searchParams.has('fail')) failPage = url.searchParams.get('fail') === '1';
    return send(response, 200, JSON.stringify({ version, failPage }), { 'content-type': 'application/json' });
  }

  if (url.pathname === '/status') {
    return send(response, 200, JSON.stringify({ version, failPage, authorizationHeaderCount, secretRequestCount }), {
      'content-type': 'application/json',
    });
  }

  if (url.pathname === '/redirect-ok') {
    return send(response, 302, '', { location: '/page' });
  }

  if (url.pathname === '/redirect-block') {
    return send(response, 302, '', { location: 'http://runtime-web:18080/secret' });
  }

  if (url.pathname === '/auth') {
    if (request.headers.authorization) {
      authorizationHeaderCount += 1;
      return send(response, 200, '<html><body>private authenticated content</body></html>', {
        'content-type': 'text/html; charset=utf-8',
      });
    }
    return send(response, 401, 'authentication required', {
      'www-authenticate': 'Basic realm="runtime-test"',
      'content-type': 'text/plain; charset=utf-8',
    });
  }

  if (url.pathname === '/page') {
    if (failPage) return send(response, 503, 'temporarily unavailable', { 'content-type': 'text/plain' });
    return send(
      response,
      200,
      `<html><head><title>Runtime Preview ${version}</title></head><body style="background:rgb(${version * 20},40,80)"><h1 id="version">preview-v${version}</h1></body></html>`,
      { 'content-type': 'text/html; charset=utf-8' }
    );
  }

  if (url.pathname === '/secret') {
    secretRequestCount += 1;
    return send(response, 200, '<html><body>loopback secret</body></html>', { 'content-type': 'text/html' });
  }

  return send(response, 404, 'not found', { 'content-type': 'text/plain' });
}).listen(18080, '0.0.0.0', () => {
  process.stdout.write('fixture-ready\n');
});
