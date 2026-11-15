import { Vehicle } from '../src/car/physics.js';
const v = new Vehicle(); v.reset(0,0,0); v.steerAssist=0;
const dt=1/60; let t=0;
function run(sec, inp, log){ for(let i=0;i<sec*60;i++){ Object.assign(v.input,inp); v.update(dt); t+=dt; if(log && i%30==0) log(); } }
const L=()=>console.log(t.toFixed(1),'kmh',(v.speed*3.6).toFixed(1),'g',v.gear,'rpm',v.rpm|0,'sr',v.slipRatio[2].toFixed(2),'yaw',v.yawRate.toFixed(2),'drift',(v.driftAngle*57.3).toFixed(0), 'pos',v.x.toFixed(0),v.z.toFixed(0));
let t100=null; for(let i=0;i<60*25;i++){Object.assign(v.input,{throttle:1});v.update(dt);t+=dt; if(!t100 && v.speed*3.6>=100) t100=t;}
console.log('0-100',t100?.toFixed(2),'speed after 25s',(v.speed*3.6).toFixed(0),'gear',v.gear);
// brake from current
let d0=[v.x,v.z]; const s0=v.speed; run(8,{throttle:0,brake:1}); console.log('brake from',(s0*3.6)|0,'dist',Math.hypot(v.x-d0[0],v.z-d0[1]).toFixed(0),'speed',v.speed.toFixed(2));
// reverse
run(1.5,{throttle:0,brake:1}); console.log('gear after hold brake',v.gear,'speed',v.speed.toFixed(2));
v.reset(0,0,0); t=0;
console.log('--- cornering 70kmh steer 0.3');
run(6,{throttle:0.6,brake:0,steer:0}); run(4,{throttle:0.35,steer:0.3},L);
console.log('--- handbrake drift attempt');
v.reset(0,0,0); t=0; v.steerAssist=0.6;
run(6,{throttle:0.7,steer:0}); L(); run(0.5,{throttle:0.2,steer:1,handbrake:1},L); run(4,{throttle:0.9,steer:-0.2,handbrake:0},L);
console.log('--- donut');
v.reset(0,0,0); t=0; run(2,{throttle:0.5}); run(6,{throttle:1,steer:1},L);
console.log('--- stationary stability'); v.reset(0,0,0); t=0; run(5,{throttle:0}); L();
