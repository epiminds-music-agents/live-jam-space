import { createServer, IncomingMessage, ServerResponse } from 'http';
import { neoHandler } from './agents/neo';
import { morpheusHandler } from './agents/morpheus';
import { smithHandler } from './agents/smith';

const PORT = 3002;

const agents = {
  '/neo': neoHandler,
  '/morpheus': morpheusHandler,
  '/smith': smithHandler,
};

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  const url = req.url || '';
  const handler = agents[url as keyof typeof agents];

  if (!handler) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  // Parse Body
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      // Mock Request object for handler
      const mockRequest = {
        json: async () => parsedBody,
      } as unknown as Request;

      const response = await handler(mockRequest);
      
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      const responseBody = await response.text();
      res.end(responseBody);
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Function Runtime (Gateway) running on http://localhost:${PORT}`);
  console.log('Available Functions:');
  Object.keys(agents).forEach(path => console.log(` - POST http://localhost:${PORT}${path}`));
});
