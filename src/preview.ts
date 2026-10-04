// Previews of what the agents built in Build mode. Each preview serves one agent's copy as plain files on its own
// loopback port, so the page runs in an origin of its own and can't reach the room or its token. The link AvA hands
// out carries a key that sets a SameSite cookie, and every other request needs that cookie, so other websites can't
// load the files.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AvAError } from './types.js';
import { isInside } from './workspace.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm',
};
// Where a built web app usually starts. A preview serves the folder holding that page, so root-relative links in a
// built site (say /assets/app.js from dist/index.html) work.
const ENTRY_DIRS = ['', 'public', 'dist', 'build', 'www', 'app', 'src', 'docs'];
export function findEntry(root: string) {
  for (const dir of ENTRY_DIRS) if (existsSync(join(root, dir, 'index.html'))) return dir ? `${dir}/index.html` : 'index.html';
  return readdirSync(root).filter(n => /\.html?$/i.test(n)).sort()[0] ?? '';
}
// The page to open for a folder: its index.html (or a built one in dist/ and the like), else its first HTML file.
export function pageIn(folder: string) {
  const entry = findEntry(folder);
  return entry ? { root: dirname(join(folder, entry)), page: basename(entry), entry } : { root: folder, page: '', entry: '' };
}
// The app an agent named at the end of a build: "APP: <page or folder, relative to its working directory>" or
// "APP: http://localhost:<port>/" for a server it left running. Anything else (another host, a path outside the
// workspace, a missing file) is ignored.
export type AppTarget = { kind: 'page'; path: string } | { kind: 'server'; url: string; port: number };
export function appTarget(text: string, workspace: string): AppTarget | undefined {
  // Line by line, from the end, and only short lines: one pattern over the whole reply backtracks quadratically on a
  // long run of spaces or blank lines, which would stall the service.
  let named: string | undefined;
  for (const line of text.split(/\r?\n/).reverse()) if (line.length <= 2000 && (named = /^[\s>*_-]*APP[*_\s]*:[*_\s]*(.*)$/i.exec(line)?.[1]?.trim())) break;
  if (!named) return undefined;
  let value = named.replace(/^[\s`'"<*_]+|[\s`'">*_.]+$/g, '').replace(/^\[[^\]]*\]\((.*)\)$/, '$1').trim();
  if (/^https?:\/\//i.test(value)) {
    try { const url = new URL(value); if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port) return { kind: 'server', url: url.href, port: Number(url.port) }; } catch { /* not a URL */ }
    return undefined;
  }
  if (/^file:\/\//i.test(value)) { try { value = fileURLToPath(value); } catch { return undefined; } }
  const full = resolve(workspace, value);
  if (!within(full, workspace) || !existsSync(full)) return undefined;
  // A link or junction inside the copy that leads outside it doesn't count either.
  try { if (!within(realpathSync(full), realpathSync(workspace))) return undefined; } catch { return undefined; }
  return { kind: 'page', path: relative(workspace, full) };
}
// Never served: the copy's git data, and Windows names that reach the same file another way (a trailing dot or space,
// or an alternate data stream after a colon).
const HIDDEN = /(^|[\\/])\.git[. ]*([\\/]|$)|:/i;
// Compared as bytes: two strings of the same length can differ in byte length, and timingSafeEqual throws on that.
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const escape = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const within = (child: string, parent: string) => process.platform === 'win32' ? isInside(child.toLowerCase(), parent.toLowerCase()) : isInside(child, parent);

interface Preview { server: Server; port: number; key: string; root: string; realRoot: string; used: number }
export class Previews {
  private open_ = new Map<string, Preview>();
  // One start at a time per id, so two clicks at once can't leave a second server running unreferenced.
  private starting = new Map<string, Promise<Preview>>();
  constructor(private readonly limit = 8) {}
  // A preview link serving root, opening page (a file in it; '' lists the folder). id names the run and seat; its
  // server is reused while the folder stays the same.
  async open(id: string, root: string, page: string) {
    if (!existsSync(root)) throw new AvAError('NO_COPY', 'This agent’s folder is no longer there.');
    for (let pending = this.starting.get(id); pending; pending = this.starting.get(id)) await pending.catch(() => {});
    let preview = this.open_.get(id);
    if (preview && preview.root !== root) { this.close(id); preview = undefined; }
    if (!preview) {
      const start = this.serve(root); this.starting.set(id, start);
      try { preview = await start; } finally { this.starting.delete(id); }
      this.open_.set(id, preview);
      // Only the most recently used previews keep a server.
      const oldest = [...this.open_].sort((a, b) => a[1].used - b[1].used);
      while (this.open_.size > this.limit) this.close(oldest.shift()![0]);
    }
    preview.used = Date.now();
    return { url: `http://127.0.0.1:${preview.port}/__ava/open?key=${preview.key}&path=${encodeURIComponent(page)}`, origin: `http://127.0.0.1:${preview.port}` };
  }
  close(id: string) {
    const preview = this.open_.get(id); if (!preview) return;
    this.open_.delete(id); preview.server.closeAllConnections(); preview.server.close();
  }
  closeAll() { for (const id of [...this.open_.keys()]) this.close(id); }
  private async serve(root: string): Promise<Preview> {
    const preview: Preview = { server: createServer(), port: 0, key: randomBytes(32).toString('hex'), root, realRoot: realpathSync.native(root), used: Date.now() };
    // A request that fails unexpectedly fails alone: an error thrown here would otherwise stop the whole service.
    preview.server.on('request', (req, res) => { try { this.handle(preview, req, res); } catch { if (res.headersSent) res.destroy(); else { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Preview error'); } } });
    await new Promise<void>((done, fail) => { preview.server.once('error', fail); preview.server.listen(0, '127.0.0.1', done); });
    const address = preview.server.address();
    if (!address || typeof address === 'string') throw new Error('No local address');
    preview.port = address.port; preview.server.unref();
    return preview;
  }
  private handle(p: Preview, req: IncomingMessage, res: ServerResponse) {
    const host = `127.0.0.1:${p.port}`, head = req.method === 'HEAD', cookieName = `ava_preview_${p.port}`;
    const send = (status: number, body: string, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(head ? undefined : body);
    };
    if (req.headers.host !== host) return send(403, 'Invalid host');
    if (req.method !== 'GET' && !head) return send(405, 'Method not allowed');
    let url: URL; try { url = new URL(req.url ?? '/', `http://${host}`); } catch { return send(400, 'Invalid URL'); }
    if (url.pathname === '/__ava/open') {
      if (!same(url.searchParams.get('key') ?? '', p.key)) return send(403, 'This preview link has expired. Open the preview again from Agent vs Agent.');
      const page = (url.searchParams.get('path') ?? '').split('/').map(encodeURIComponent).join('/');
      res.writeHead(302, { 'Set-Cookie': `${cookieName}=${p.key}; Path=/; HttpOnly; SameSite=Strict`, Location: `/${page}`, 'Cache-Control': 'no-store' }); res.end(); return;
    }
    const cookie = (req.headers.cookie ?? '').split(';').map(c => c.trim().split('=')).find(([name]) => name === cookieName)?.[1] ?? '';
    if (!same(cookie, p.key)) return send(403, 'Open this preview from Agent vs Agent.');
    let path: string; try { path = decodeURIComponent(url.pathname); } catch { return send(400, 'Invalid URL'); }
    if (path.includes('\0')) return send(400, 'Invalid URL');
    let file = resolve(p.root, `.${path}`);
    if (!within(file, p.root) || HIDDEN.test(relative(p.root, file))) return send(404, 'Not found');
    // Checked on the real path, before anything is listed or read: a link or junction inside the copy that leads outside
    // it isn't followed, and a short (8.3) name such as GIT~1 doesn't reach the git data.
    const hidden = (path: string) => { const real = realpathSync.native(path); return !within(real, p.realRoot) || HIDDEN.test(relative(p.realRoot, real)); };
    try {
      let stat = statSync(file);
      if (hidden(file)) return send(404, 'Not found');
      if (stat.isDirectory()) {
        if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: `${url.pathname}/`, 'Cache-Control': 'no-store' }); res.end(); return; }
        if (!existsSync(join(file, 'index.html'))) return this.listing(file, url.pathname, send);
        file = join(file, 'index.html'); stat = statSync(file);
        if (hidden(file)) return send(404, 'Not found');
      }
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-site', 'Content-Security-Policy': 'frame-ancestors http://127.0.0.1:*',
      });
      if (head) res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { send(404, 'Not found'); }
  }
  private listing(dir: string, path: string, send: (status: number, body: string, type?: string) => void) {
    const entries = readdirSync(dir, { withFileTypes: true }).filter(e => !HIDDEN.test(e.name)).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const items = entries.map(e => { const name = e.name + (e.isDirectory() ? '/' : ''); return `<li><a href="${escape(encodeURIComponent(e.name) + (e.isDirectory() ? '/' : ''))}">${escape(name)}</a></li>`; }).join('');
    send(200, `<!doctype html><meta charset="utf-8"><title>${escape(path)}</title><style>body{font:14px system-ui,sans-serif;margin:24px;color:#1d1d1f}a{color:#0066cc;text-decoration:none}li{margin:4px 0}</style><p>No index.html here. Files in ${escape(path)}:</p><ul>${path === '/' ? '' : '<li><a href="../">../</a></li>'}${items || '<li>(empty)</li>'}</ul>`, 'text/html; charset=utf-8');
  }
}
