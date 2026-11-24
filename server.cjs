// Optional local server. No npm installation or external network is needed.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = __dirname;
const port = Number(process.env.C_STUDY_PORT || 8765);
const shouldOpen = process.argv.includes('--open') && process.env.C_STUDY_NO_OPEN !== '1';
const url = `http://127.0.0.1:${port}/`;
const terminalBound = process.platform === 'win32' && process.argv.includes('--terminal-bound');
const ownerPid = process.ppid;
function stopServer() {
  server.close();
  server.closeAllConnections();
  process.exit(0);
}
if (terminalBound) {
  // Also stop if the terminal closes without forwarding a console signal to Node.
  const ownerWatch = setInterval(() => {
    try {process.kill(ownerPid, 0);} catch (err) {if (err.code === 'ESRCH') stopServer();}
  }, 250);
  ownerWatch.unref();
}
process.on('SIGINT', stopServer);
process.on('SIGBREAK', stopServer);
process.on('SIGHUP', stopServer);
function openBrowser() {
  if (!shouldOpen) return;
  const {execFile} = require('node:child_process');
  const [cmd, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  execFile(cmd, args, {windowsHide:true}, err => {
    if (err) console.error(`浏览器未能自动打开，请复制此地址打开：${url}`);
  });
}
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8','.pdf':'application/pdf','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer(async (req, res) => {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/_c-study/status') {res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({app:'c-system-study',version:2,pid:process.pid,ownerPid,terminalBound}));return;}
    if (pathname === '/favicon.ico') {res.writeHead(204, {'Content-Length':'0'});res.end();return;}
    if (pathname === '/') {res.writeHead(302, {'Location':encodeURI('/复习网站/index.html')});res.end();return;}
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(p=>p.startsWith('.'))) {res.writeHead(403);res.end('Forbidden');return;}
    const stat = await fs.stat(file);
    if (!stat.isFile()) {res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200, {'Content-Type':types[path.extname(file).toLowerCase()] || 'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method === 'HEAD') {res.end();return;}
    res.end(await fs.readFile(file));
  } catch {res.writeHead(404);res.end('Not found');}
});
server.on('error', err => {
  console.error('无法启动本地网站：'+err.message);
  if (err.code === 'EADDRINUSE') console.error(`端口 ${port} 已在使用中。请先关闭原来运行网站的终端窗口，再重新启动。`);
  process.exitCode=1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`C 语言复习网站：${url}\n保持这个黑色终端窗口打开。关闭窗口或按 Ctrl+C 即停止网站服务。`);
  openBrowser();
});
