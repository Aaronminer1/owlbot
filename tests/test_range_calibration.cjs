const assert=require('node:assert/strict');
const api=require('../app/src/main/assets/spatial-awareness.js');
const cfg=api.config({mount:'body',frontOffsetMm:60,rangeCalibration:{scale:1.035,rawMinMm:293,rawMaxMm:591}});
for(const [raw,expected] of [[294,304],[440,455],[589,610]])assert.equal(api.calibratedDistance(raw,cfg),expected);
for(const raw of [null,NaN,0,292,592,664,800])assert.equal(api.calibratedDistance(raw,cfg),null);
for(const value of [null,{scale:1.5,rawMinMm:293,rawMaxMm:591},{scale:1.035,rawMinMm:600,rawMaxMm:300}])assert.equal(api.rangeCalibration(value),null);
const store=new api.Store(),ctx={pan:0,tilt:0,headMoving:false,headAgeMs:0,bodyMoving:false};
store.accept({version:1,enabled:true,status:'echo',distance_mm:440,age_ms:0,sample:1},1000,0,ctx,cfg);
const s=store.snapshot(1000,ctx,cfg);
assert.equal(s.beamDistanceMm,440);assert.equal(s.calibratedBeamDistanceMm,455);
assert.equal(s.forwardRangeMm,380,'Never inflate walking clearance with a near-range correction');
assert.equal(store.snapshot(3000,ctx,cfg).calibratedBeamDistanceMm,null);
assert.equal(store.snapshot(1000,ctx,{...cfg,enabled:false}).calibratedBeamDistanceMm,null);
assert.equal(api.config(JSON.parse(JSON.stringify(cfg))).rangeCalibration.scale,1.035);
const pair={at:1000,range:s,camera:'front',forwardCamera:'front',cameraGeneration:1,headGeneration:1,headPose:'center',epoch:1,moving:false,
 visual:{target:'box',centered:true,occluded:false,ambiguous:false}};
// Association is still only a candidate: calibration never removes the normal gates.
const current={now:1200,range:s,camera:'front',cameraGeneration:1,headGeneration:1,headPose:'center',epoch:1,moving:false};
assert.equal(api.associate(pair,current),null,'body-mounted setup cannot assume camera co-mounting');
pair.range={...s,mount:'head'};current.range=pair.range;
assert.equal(api.associate(pair,current).distanceMm,455);assert.equal(api.associate(pair,current).rawDistanceMm,440);
assert.equal(api.associate({...pair,visual:{...pair.visual,ambiguous:true}},current),null);
console.log('PASS bounded near-range calibration, raw preservation, holdout, no extrapolation or clearance inflation, and association gates');
