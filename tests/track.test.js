import { TrackData } from '../src/world/trackData.js';
const t=new TrackData(); console.log('length',t.length.toFixed(0),'N',t.N);
let minR=1e9, at=0; for(let i=0;i<t.N;i++){const r=1/Math.abs(t.curv[i]); if(r<minR){minR=r;at=i;}} console.log('minR',minR.toFixed(1),'at',t.x[at].toFixed(0),t.z[at].toFixed(0));
// clearance: min distance between samples > 60m apart along track
let minC=1e9,ca=null; for(let i=0;i<t.N;i+=2)for(let j=0;j<t.N;j+=2){let ds=Math.abs(t.s[i]-t.s[j]); ds=Math.min(ds,t.length-ds); if(ds<90) continue; const d=Math.hypot(t.x[i]-t.x[j],t.z[i]-t.z[j]); if(d<minC){minC=d;ca=[i,j];}}
console.log('min clearance',minC.toFixed(1),ca.map(i=>[t.x[i]|0,t.z[i]|0]));
const fs=await import('fs'); fs.writeFileSync('/tmp/track.json',JSON.stringify({x:[...t.x],z:[...t.z],hw:[...t.hw],c:[...t.curv]}));
