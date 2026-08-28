#!/usr/bin/env node
const http = require('http');

const endpoint = process.argv[2];
if (!endpoint) {
  console.error('missing collector endpoint');
  process.exit(2);
}

const url = new URL(endpoint);
const request = http.request({
  hostname: url.hostname,
  port: url.port,
  path: `${url.pathname}${url.search}`,
  method: 'POST',
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked'
  }
});

request.on('response', (response) => {
  response.resume();
  response.on('end', () => process.exit(response.statusCode === 200 ? 0 : 1));
});
request.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
process.stdin.on('error', () => request.destroy());
process.stdin.pipe(request);
