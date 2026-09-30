/* Synthetic evidence tests only: no network, camera, serial or motor access. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'../app/src/main/assets/spatial-awareness.js');
const source=fs.readFileSync(file,'utf8'),api=require(file);
const echo=(distance=1200,sample=1)=>({version:1,enabled:true,status:'echo',distance_mm:distance,age_ms:20,sample});
const front={pan:0,tilt:0,headMoving:false,headAgeMs:20,bodyMoving:false};
const head=api.config({mount:'head'}),body=api.config({mount:'body',frontOffsetMm:100});
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('unknown mount gives raw beam, not invented forward clearance',()=>{
 const s=new api.Store();s.accept(echo(),1000,40,front,api.config());const r=s.snapshot(1000,front,api.config());
 assert.equal(r.beamDistanceMm,1200);assert.equal(r.forwardRangeMm,null);assert.equal(r.localMap.sectors.length,0);
 assert.equal(r.motionAuthorized,false);assert.equal(r.localMap.odometryAvailable,false);
});
test('aligned mounting, configured offset and conservative fresh close echo',()=>{
 const s=new api.Store();for(let i=0;i<3;i++)s.accept(echo(1200,i),1000+i*100,20,front,body);
 s.accept(echo(250,4),1300,20,front,body);assert.equal(s.snapshot(1300,front,body).forwardRangeMm,150);
 assert.equal(s.snapshot(2900,front,body).forwardRangeMm,null);
});
test('head-down, moving, released, side or stale head is not forward',()=>{
 for(const ctx of [{...front,tilt:-.6},{...front,pan:-.5},{...front,headMoving:true},{...front,headAgeMs:1300}]){
  const s=new api.Store();s.accept(echo(),1000,10,ctx,head);assert.equal(s.snapshot(1000,ctx,head).forwardRangeMm,null);
 }
 const s=new api.Store();s.accept(echo(),1000,10,front,head);
 assert.equal(s.snapshot(1000,front,head).forwardRangeMm,1200);
 assert.equal(s.snapshot(1000,{...front,pan:.1},head).forwardRangeMm,null,'new pose cannot borrow earlier echo');
 assert.equal(s.snapshot(1000,{...front,headEpoch:2},head).forwardRangeMm,null,'returning to an old pose is still a new motion');
 assert.equal(api.direction({...front,tilt:-.6},api.config({mount:'head',forwardTilt:-.6})),'front');
});
test('local sectors accumulate only while stationary and expire',()=>{
 const s=new api.Store();for(const [i,pan] of [-.6,0,.6].entries())s.accept(echo(1200,i),1000+i*100,0,{...front,pan},head);
 assert.deepEqual(s.snapshot(1200,front,head).localMap.sectors.map(x=>x.direction),['left','front','right']);
 assert.equal(s.snapshot(9500,front,head).localMap.sectors.length,0);
 s.moved();assert.equal(s.snapshot(1300,front,head).beamDistanceMm,null);
 assert.equal(s.snapshot(1300,front,head).localMap.sectors.length,0);
});
test('no echo is unknown, removes affected sector, never clear',()=>{
 const s=new api.Store();s.accept(echo(),1000,0,front,head);
 s.accept({...echo(),status:'no_echo',distance_mm:null,sample:2},1100,0,front,head);
 const r=s.snapshot(1100,front,head);assert.equal(r.forwardRangeMm,null);assert.equal(r.localMap.sectors.length,0);
 assert.match(api.summary(r),/not a reason by itself to freeze/);
});
test('malformed, delayed, stale and disabled readings do not grant range',()=>{
 for(const value of [{...echo(),age_ms:2000},{...echo(),distance_mm:NaN},{...echo(),sample:-1},{...echo(),enabled:false},null]){
  const s=new api.Store();assert.equal(s.accept(value,1000,0,front,head),false);assert.equal(s.snapshot(1000,front,head).forwardRangeMm,null);
 }
 const s=new api.Store();assert.equal(s.accept(echo(),1000,1001,front,head),false);
 s.accept(echo(),1000,0,front,head);assert.equal(s.snapshot(1000,front,{...head,enabled:false}).forwardRangeMm,null);
});
test('visual observation is fresh, directional, and cleared on rejected update',()=>{
 const s=new api.Store();s.recordVision({path:'clear',floor_visible:true},1000,900,'backward');
 assert.equal(s.snapshot(1000,front,head).vision.direction,'backward');
 assert.equal(s.snapshot(3501,front,head).vision,null);
 s.recordVision({path:'blocked',floor_visible:true},1200,1100,'forward');assert.equal(s.snapshot(1200,front,head).vision.path,'blocked');
 s.recordVision(null,1300,1200,'forward');assert.equal(s.snapshot(1300,front,head).vision,null);
});
function runtime(){
 let now=1000,wall=10000;const sent=[],storage=new Map();
 const box={performance:{now:()=>now},Date:{now:()=>wall},document:{hidden:false,getElementById:()=>null},
  localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},APP:{resting:false},
  S:{ws:{url:'wss://example.invalid/controller'},rid:10,pendingAcks:new Map(),sim:false,running:false},
  HEAD:{state:{holding:true,moving:false,pan:0,tilt:0},stateAt:wall},
  headSemanticPosition:(axis,state)=>state?.[axis],BODY_COMMAND_LANE:{active:'',queued:0},
  bodyControllerReady:()=>true,walkingStreamStatus:()=>({active:false}),sensorAwarenessSnapshot:()=>({}),
  waitBodyAck:rid=>new Promise(resolve=>box.S.pendingAcks.set(rid,resolve)),
  cancelBodyAck:(rid,err)=>{const cb=box.S.pendingAcks.get(rid);box.S.pendingAcks.delete(rid);cb?.({ok:0,err});},
  wsSend:request=>{assert.ok(box.S.pendingAcks.has(request.rid),'ACK waiter registered first');sent.push(request);return true;}};
 vm.createContext(box);vm.runInContext(source,box);
 const ack=value=>{const req=sent.at(-1),cb=box.S.pendingAcks.get(req.rid);box.S.pendingAcks.delete(req.rid);cb(value);};
 return {box,sent,ack,advance:ms=>{now+=ms;wall+=ms;},eval:code=>vm.runInContext(code,box)};
}
(async()=>{
 let r=runtime();let pending=r.box.spatialPoll();assert.equal(r.sent[0].t,'dog_info');r.ack({ok:1});await pending;
 r.advance(1000);await r.box.spatialPoll();assert.equal(r.sent.length,1,'unsupported firmware backoff');
 r.advance(30000);pending=r.box.spatialPoll();assert.equal(r.sent.at(-1).t,'dog_info');r.ack({ok:1,ultrasonic:echo()});await pending;
 r.advance(500);pending=r.box.spatialPoll();assert.equal(r.sent.at(-1).channel_action,'range_info');
 assert.equal(r.box.BODY_COMMAND_LANE.active,'','poll never occupies motor queue');
 await r.box.spatialPoll();assert.equal(r.sent.length,3,'one sensor request in flight');
 r.ack({ok:1,ultrasonic:echo()});await pending;assert.equal(r.box.spatialSnapshot().beamDistanceMm,1200);
 r.advance(500);r.box.BODY_COMMAND_LANE.active='stop';await r.box.spatialPoll();assert.equal(r.sent.length,3);
 r.box.BODY_COMMAND_LANE.active='';pending=r.box.spatialPoll();r.box.APP.resting=true;r.ack({ok:1,ultrasonic:echo()});await pending;
 assert.equal(r.box.spatialSnapshot().beamDistanceMm,null,'sleep rejects pending range');
 console.log('PASS capability discovery, independent ACK lane, one in flight, priority and sleep');checks++;
 r=runtime();pending=r.box.spatialPoll();r.box.S.ws={url:'wss://example.invalid/new'};r.ack({ok:1,ultrasonic:echo()});await pending;
 assert.equal(r.box.spatialSnapshot().beamDistanceMm,null,'old socket reply rejected');
 r=runtime();pending=r.box.spatialPoll();r.advance(1100);r.ack({ok:1,ultrasonic:echo()});await pending;
 assert.equal(r.box.spatialSnapshot().beamDistanceMm,null,'high latency rejected');
 r=runtime();pending=r.box.spatialPoll();r.box.spatialObserveCommand({t:'dog_cal',channel_action:'walk_run'});
 r.ack({ok:1,ultrasonic:echo()});await pending;assert.equal(r.box.spatialSnapshot().beamDistanceMm,null,'movement after sampling began invalidates reply');
 console.log('PASS delayed and replaced-connection reply rejection');checks++;
 r=runtime();r.box.spatialEnsure();r.eval("SPATIAL.cfg=OwlSpatial.config({mount:'head'})");
 r.advance(100);pending=r.box.spatialPoll();r.ack({ok:1,ultrasonic:echo()});await pending;
 assert.equal(r.box.spatialSnapshot().forwardRangeMm,null,'first sample may predate observing the pose');
 r.advance(500);pending=r.box.spatialPoll();r.ack({ok:1,ultrasonic:echo(1200,2)});await pending;
 assert.equal(r.box.spatialSnapshot().forwardRangeMm,1200);
 r.advance(500);pending=r.box.spatialPoll();r.box.HEAD.state.pan=.6;r.ack({ok:1,ultrasonic:echo(600,2)});await pending;
 assert.equal(r.box.spatialSnapshot().forwardRangeMm,null,'head change during request');
 r.box.spatialObserveCommand({t:'dog_cal',body_action:'turn'});assert.equal(r.box.spatialSnapshot().beamDistanceMm,null);
 console.log('PASS pose sampling window and body-command map invalidation');checks++;
 const phone=path.dirname(file),html=fs.readFileSync(path.join(phone,'growbot-brain.html'),'utf8');
 assert.ok(/name:\s*["']read_distance["']/.test(html));assert.ok(/spatial-awareness\.js/.test(html));
 assert.match(fs.readFileSync(path.join(phone,'executive-context.js'),'utf8'),/spatialAwareness:typeof spatialSnapshot/);
 assert.match(fs.readFileSync(path.join(phone,'named-walk.js'),'utf8'),/spatialVisionContext\(direction\)/);
 assert.doesNotMatch(source,/headMove\(|channelCommand\(|mindFetch\(|runNamedForwardWalk\(/);
 console.log('PASS tool, bounded executive and vision wiring; no new model or motor calls');checks++;
 console.log(`PASS ${checks} spatial-awareness scenario groups; synthetic only, no physical validation.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
