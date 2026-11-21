const assert = require('node:assert/strict');
const http = require('node:http');
const {randomUUID} = require('node:crypto');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {createInterface} = require('node:readline');
const {once} = require('node:events');

async function main() {
  const script = path.join(__dirname, '../tools/mind-proxy.mjs');
  const env = {...process.env, HOST: '127.0.0.1', PORT: '0', OLLAMA_API_KEY: randomUUID(),
    OWLBOT_PROXY_TOKEN: '', GROWBOT_PROXY_TOKEN: '', OWLBOT_PROXY_ORIGIN: 'https://client.example'};
  const startup = spawnSync(process.execPath, [script], {env, encoding: 'utf8', timeout: 5000});
  assert.equal(startup.status, 1);
  assert.match(startup.stderr, /OWLBOT_PROXY_TOKEN/);

  const upstreamAuth = [];
  const upstream = http.createServer((req, res) => {
    upstreamAuth.push(req.headers.authorization);
    res.end('fixture response');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  env.UPSTREAM = 'http://127.0.0.1:' + upstream.address().port + '/v1';
  env.OWLBOT_PROXY_TOKEN = randomUUID();
  const child = spawn(process.execPath, [script], {env, stdio: ['ignore','pipe','inherit']});
  const exited = once(child, 'exit');
  const lines = createInterface({input: child.stdout});
  try {
    const [line] = await once(lines, 'line', {signal: AbortSignal.timeout(5000)});
    const port = /127\.0\.0\.1:(\d+)/.exec(line)[1];
    const url = 'http://127.0.0.1:' + port + '/v1/models';
    const headers = {Origin: env.OWLBOT_PROXY_ORIGIN};
    assert.equal((await fetch(url, {headers})).status, 401);
    assert.equal((await fetch(url, {method: 'OPTIONS', headers: {Origin: 'https://other.example'}})).status, 403);
    const preflight = await fetch(url, {method: 'OPTIONS', headers});
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), headers.Origin);
    const response = await fetch(url, {headers: {...headers, Authorization: 'Bearer ' + env.OWLBOT_PROXY_TOKEN}});
    assert.equal(await response.text(), 'fixture response');
    assert.deepEqual(upstreamAuth, ['Bearer ' + env.OLLAMA_API_KEY]);
  } finally {
    child.kill();
    await exited;
    upstream.close();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
