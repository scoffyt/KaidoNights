import { TrackData, computeRacingLine } from '../src/world/trackData.js';
import { Vehicle } from '../src/car/physics.js';
import { AIDriver } from '../src/car/ai.js';
const t=new TrackData(); const L=computeRacingLine(t);
function run(level, style, secs=200){
 const v=new Vehicle(); const p=t.pointAt(40); v.reset(p.x,p.z,Math.atan2(p.tx,p.tz));
 v.tcs = style!=='drift'; v.driftAssist=0.6; v.steerAssist=0;
 let hint=-1; v.surfaceFn=(x,z)=>{const q=t.project(x,z,hint); return q.dist<q.hw?{mu:1,type:'asphalt'}:{mu:0.55,type:'grass'}};
 const car={veh:v,trackInfo:null}; const ai=new AIDriver(t,L,level,style);
 let dist=0, lastS=null, maxOff=0, offT=0, laps=[], lapStart=0, time=0, driftT=0, angSum=0;
 for(let i=0;i<secs*60;i++){ car.trackInfo=t.project(v.x,v.z,hint); hint=car.trackInfo.i;
   const s=car.trackInfo.s; if(lastS!==null){let d=s-lastS; if(d<-t.length/2)d+=t.length; if(d>t.length/2)d-=t.length; dist+=d; if(dist>=t.length*(laps.length+1)){laps.push((time-lapStart).toFixed(1)); lapStart=time;}} lastS=s;
   maxOff=Math.max(maxOff,car.trackInfo.dist-car.trackInfo.hw); if(car.trackInfo.dist>car.trackInfo.hw+1) offT+=1/60;
   const inp=ai.update(1/60,car,[]); Object.assign(v.input,inp); v.update(1/60); time+=1/60;
   const [u,lv]=v.localVel(); const a=Math.abs(Math.atan2(lv,Math.max(1,u)))*57.3; if(a>15&&v.speed>8){driftT+=1/60; angSum+=a/60;}
   if(laps.length>=2) break;
 }
 console.log(level,style,'laps',laps,'dist',(dist/t.length).toFixed(2),'maxOff',maxOff.toFixed(1),'offT',offT.toFixed(1),'driftT',driftT.toFixed(0),'avgAng',(angSum/Math.max(1,driftT)).toFixed(0));
}
run('easy','race'); run('normal','race'); run('hard','race'); run('normal','drift',260);
