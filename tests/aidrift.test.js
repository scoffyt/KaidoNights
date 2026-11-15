import { TrackData, computeRacingLine } from '../src/world/trackData.js';
import { Vehicle } from '../src/car/physics.js';
import { AIDriver } from '../src/car/ai.js';
const t=new TrackData(); const L=computeRacingLine(t);
const v=new Vehicle(); const p=t.pointAt(40); v.reset(p.x,p.z,Math.atan2(p.tx,p.tz)); v.driftAssist=0.6; v.steerAssist=0;
let hint=-1; v.surfaceFn=(x,z)=>{const q=t.project(x,z,hint); return q.dist<q.hw?{mu:1,type:'asphalt'}:{mu:0.55,type:'grass'}};
const car={veh:v}; const ai=new AIDriver(t,L,'normal','drift');
let out='';
for(let i=0;i<60*40;i++){ car.trackInfo=t.project(v.x,v.z,hint); hint=car.trackInfo.i; const inp=ai.update(1/60,car,[]); Object.assign(v.input,inp); v.update(1/60);
 if(i%20==0){const [u,lv]=v.localVel(); out+=`${(i/60).toFixed(1)} s=${car.trackInfo.s.toFixed(0)} lat=${car.trackInfo.lat.toFixed(1)} v=${(v.speed*3.6).toFixed(0)} ang=${(Math.atan2(-lv,Math.max(1,u))*57.3).toFixed(0)} st=${inp.steer.toFixed(2)} th=${inp.throttle.toFixed(1)} hb=${inp.handbrake} k=${(t.curv[car.trackInfo.i]*100).toFixed(2)}\n`;}
}
console.log(out);
