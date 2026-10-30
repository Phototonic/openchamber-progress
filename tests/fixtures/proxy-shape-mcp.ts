/** Synthetic transport cases; live-shape metadata replays parent-provided observations. */
import readline from 'node:readline';
import { trackerShape } from './activation-proxy-shapes.ts';
const inputSchema = { type: 'object', properties: { mode: { type: 'string', enum: ['structured', 'json-text', 'plain-text', 'error', 'partial', 'rpc-error', 'live-shape', 'live-shape-json-text', 'live-shape-partial', 'live-shape-error'] } }, required: ['mode'], additionalProperties: false };
for await (const line of readline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result: any;
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'synthetic-proxy-fixture', version: '1' } };
  else if (request.method === 'tools/list') result = { tools: ['save_issue', 'save_comment'].map(name => ({ name, description: 'Synthetic transport diagnostic, not a tracker operation', inputSchema })) };
  else if (request.method === 'tools/call') {
    const mode = request.params.arguments.mode;
    // Neutral values only. Entity structure/types come from the parent's sanitized
    // live MCP observations; this server does not contact any tracker.
    const entity = trackerShape(request.params.name);
    const data = mode.startsWith('live-shape') ? { ...entity, ...(mode === 'live-shape-partial' ? { partial: true } : {}) }
      : { synthetic: true, marker: 'transport-only', ...(mode === 'partial' ? { partial: true } : {}) };
    if (mode === 'rpc-error') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Synthetic RPC failure' } }) + '\n'); continue; }
    result = { content: [{ type: 'text', text: mode === 'plain-text' ? 'Synthetic text only' : mode === 'error' ? 'Synthetic MCP failure' : JSON.stringify(data) }], ...(mode === 'structured' || mode === 'partial' || mode.startsWith('live-shape') && mode !== 'live-shape-json-text' ? { structuredContent: data } : {}), ...(mode === 'error' || mode === 'live-shape-error' ? { isError: true } : {}) };
  } else if (request.method === 'ping') result = {};
  else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unsupported synthetic method' } }) + '\n'); continue; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
