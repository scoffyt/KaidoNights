import { Vehicle } from '../src/car/physics.js';
const mod = process.argv[2]? JSON.parse(process.argv[2]):{};
const v=new Vehicle(mod); v.reset(0,0,0); v.driftAssist=0.5; v.steerAssist=0.5;
const dt=1/60;
for(let i=0;i<60*7;i++){Object.assign(v.input,{throttle:0.8,steer:0});v.update(dt);}
console.log('entry',(v.speed*3.6).toFixed(0),'gear',v.gear);
for(let i=0;i<20;i++){Object.assign(v.input,{throttle:0.5,steer:1,handbrake:1});v.update(dt);}
let line='';
for(let i=0;i<60*8;i++){
  const [u,vv]=v.localVel(); const ang=-Math.atan2(vv,u)*57.3;
  let steer=0,thr=1; if(ang>40){steer=-1;thr=0.7;} else if(ang>22){steer=0.2;thr=1;} else {steer=1;thr=1;}
  Object.assign(v.input,{handbrake:0,steer,throttle:thr}); v.update(dt);
  if(i%40==0) line+=`[${(v.speed*3.6).toFixed(0)}k ${ang.toFixed(0)}° g${v.gear} ${v.rpm|0}] `;
}
console.log(line);
