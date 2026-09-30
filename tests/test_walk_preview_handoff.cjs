const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/named-walk.js'),'utf8');
const box={Date,Promise};vm.createContext(box);vm.runInContext(source.slice(0,source.indexOf("$('#btnNamedWalkSave').onclick=")),box);
const boundary=box.nextWalkPreviewBoundary;
const state=(cycles,waiting=false)=>({run_id:9,running:true,completed_cycles:cycles,waiting_for_vision:waiting});
assert.equal(boundary(state(0),9,8,false),1);
assert.equal(boundary(state(3),9,8,false),4,'live cycle 3 needs boundary 4, not the pre-inference boundary 3');
assert.equal(boundary(state(3,true),9,8,false),3,'a feet-down pause still needs its own current boundary');
assert.equal(boundary(state(7),9,8,false),null,'do not grant an extra ninth cycle');
assert.equal(boundary(state(7),9,1,true),8,'continuous runs use their live count');
for(const invalid of [null,{}, {...state(1),run_id:8},{...state(1),running:false},{...state(1),error:'stopped'},{...state(1),completed_cycles:NaN},{...state(1),completed_cycles:-1}])assert.equal(boundary(invalid,9,8,false),null);
(async()=>{
 let latest=state(2),resolve,now=1000,checks=0,halts=0;
 const grants=[];
 const worker=box.createWalkPreviewWorker({clock:()=>now,check:()=>{checks++;return new Promise(r=>resolve=r);},guard(){},halt:async()=>halts++,grant:async(requested,left,view)=>{const actual=boundary(latest,9,8,false);grants.push({requested,actual,left,captured:view.capturedAt});return {approvedBoundary:actual};}});
 worker.request(3);
 // Reproduce the recorded race: the Pico crosses a boundary while the model
 // reads the image. The original image is still fresh and the run is unchanged.
 latest=state(3);now=1900;resolve({capturedAt:1800});await worker.wait();
 assert.deepEqual(grants,[{requested:3,actual:4,left:2400,captured:1800}]);
 worker.request(4);assert.equal(checks,1,'worker remembers actual grant; no immediate duplicate for old boundary');
 latest=state(4,true);now=2800;worker.request(4,true);resolve({capturedAt:2700});await worker.wait();
 assert.equal(grants.at(-1).actual,4,'same boundary may be refreshed while feet-down');
 now=7000;worker.request(5);resolve({capturedAt:4000});await worker.wait();
 assert.equal(grants.length,2,'expired view is not retargeted or granted');assert.equal(halts,0,'first expired view requests a new image, not an invented obstacle');
 worker.request(5);worker.close();resolve({capturedAt:6990});await worker.wait();assert.equal(grants.length,2,'Stop discards late inference');
 assert.match(source,/latestRunState=state/);
 assert.match(source,/nextWalkPreviewBoundary\(latestRunState,currentRun,cycles,continuous\)/);
 assert.match(source,/capture_offset_ms:Math\.floor\(view\.capturedAt-runAcknowledgedAt\)/,'original capture time still reaches the Pico');
 assert.match(source,/latestRunState=latest/,'rejected preview refreshes controller knowledge, not permission');
 console.log('PASS: live cycle retargeting, waiting boundary, final-cycle bound, Stop, expired frames and actual grant bookkeeping.');
})().catch(e=>{console.error(e);process.exitCode=1;});
