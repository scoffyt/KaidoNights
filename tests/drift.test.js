import { Vehicle } from '../src/car/physics.js';
// simulated keyboard driver: binary inputs trying to hold a constant-radius drift
function trial(assist, steerAssist){
 const v=new Vehicle(); v.reset(0,0,0); v.driftAssist=assist; v.steerAssist=steerAssist;
 const dt=1/60; let t=0, held=0, spins=0, maxA=0;
 for(let i=0;i<60*5;i++){Object.assign(v.input,{throttle:0.8,steer:0});v.update(dt);}
 // kick
 for(let i=0;i<30;i++){Object.assign(v.input,{throttle:0.3,steer:1,handbrake:1});v.update(dt);}
 for(let i=0;i<60*10;i++){
   const [u,vv]=v.localVel(); const beta=Math.atan2(vv,u); // negative when nose left of velocity (left drift)
   const ang=-beta*57.3; // positive = drifting left
   let steer=0, thr=1;
   if(ang>45) {steer=-1; thr=0.4;} else if(ang>25){steer=0; thr=1;} else {steer=1; thr=1;}
   v.input.handbrake=0; v.input.steer=steer; v.input.throttle=thr; v.update(dt); t+=dt;
   if(ang>15 && ang<70 && v.speed>6) held+=dt; if(Math.abs(ang)>110) spins++;
   maxA=Math.max(maxA,Math.abs(ang));
 }
 console.log('assist',assist,steerAssist,'held',held.toFixed(1),'of 10s','spinFrames',spins,'maxA',maxA.toFixed(0),'speed',(v.speed*3.6).toFixed(0));
}
for (const a of [0,0.3,0.5,0.8]) for (const s of [0,0.5]) trial(a,s);
