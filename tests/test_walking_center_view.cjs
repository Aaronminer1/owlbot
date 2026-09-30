const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../app/src/main/assets');
const walk=fs.readFileSync(path.join(root,'named-walk.js'),'utf8');
const stream=fs.readFileSync(path.join(root,'walk-stream.js'),'utf8');
// Exercise the real alignment prelude, ending before any camera/model/body work.
const start=walk.indexOf('async function checkNamedWalkPathAligned(');
const end=walk.indexOf('  const facing=navigationCameraFacing()',start);
assert(start>=0&&end>start);
const moves=[],ctx={HEAD:{generation:7},headMove:async(pose,...flags)=>{
  moves.push({pose:JSON.parse(JSON.stringify(pose)),flags});return 'Pico completed head movement';
}};
vm.createContext(ctx);vm.runInContext(walk.slice(start,end)+'return headGeneration;\n}',ctx);
(async()=>{
  for(const options of [{},{recoveryTilt:true},{courseCorrection:true},{detour:true}]){
    assert.equal(await ctx.checkNamedWalkPathAligned('forward',()=>{},null,options),7);
    assert.deepEqual(moves.at(-1),{pose:{pan:0,tilt:0,slow:true},flags:[false,true]});
  }
  const count=moves.length;
  await ctx.checkNamedWalkPathAligned('forward',()=>{},null,{keepAligned:true,headGeneration:7});
  assert.equal(moves.length,count,'Moving vision must not repeatedly recenter the head');
  await assert.rejects(ctx.checkNamedWalkPathAligned('forward',()=>{},null,{keepAligned:true,headGeneration:6}),/head changed/);
  assert(!walk.includes('recoveryTilt')&&!stream.includes('recoveryTilt'),'No retry path should force a downward tilt');
  assert(walk.includes('spatialVisionContext(direction)'),'Keep range context alongside the image');
  console.log('PASS saved level center on initial, retry, course and detour checks; no repeated moving-view commands; synthetic only');
})().catch(e=>{console.error(e);process.exitCode=1;});
