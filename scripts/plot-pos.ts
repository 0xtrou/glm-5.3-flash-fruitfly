import * as fs from "node:fs";
import { parseTopology } from "../src/lib/flywire-brain";
const buf = fs.readFileSync("public/data/flywire-topology.bin");
const topo = parseTopology(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const pos = topo.positions;
let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9,mnz=1e9,mzz=-1e9, nf=0;
for (let i=0;i<topo.n;i++){const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2];
 if(!isFinite(x+y+z)){nf++;continue;}
 if(x<mnx)mnx=x;if(x>mxx)mxx=x;if(y<mny)mny=y;if(y>mxy)mxy=y;if(z<mnz)mnz=z;if(z>mzz)mzz=z;}
console.log({n:topo.n, nf, x:[+mnx.toFixed(2),+mxx.toFixed(2)], y:[+mny.toFixed(2),+mxy.toFixed(2)], z:[+mnz.toFixed(2),+mzz.toFixed(2)]});
const W=64,H=26; const grid=new Array(W*H).fill(0);
for(let i=0;i<topo.n;i++){const x=pos[i*3],y=pos[i*3+1];
 if(!isFinite(x+y))continue;
 const gx=Math.min(W-1,Math.max(0,Math.floor((x-mnx)/(mxx-mnx||1)*W)));
 const gy=Math.min(H-1,Math.max(0,Math.floor((y-mny)/(mxy-mny||1)*H)));
 grid[gy*W+gx]++;}
for(let gy=H-1;gy>=0;gy--){let s='';for(let gx=0;gx<W;gx++){const c=grid[gy*W+gx];s+= c===0?' ':c<20?'.':c<150?'o':c<600?'O':'@';}console.log(s);}
