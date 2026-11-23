// Local preview only. No dependencies; serves this project on loopback.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp'};
function createServer(){return http.createServer((req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)||pathname.split('/').some(p=>p.startsWith('.'))){res.writeHead(403);return res.end();}
    fs.readFile(file,(error,body)=>{if(error){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(body);});
  }catch(_){res.writeHead(400);res.end();}
});}
if(require.main===module){const port=Number(process.env.PORT)||8787;createServer().listen(port,'127.0.0.1',()=>console.log(`5 Stage preview: http://127.0.0.1:${port}`));}
module.exports={createServer};
