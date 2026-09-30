const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../app/src/main/assets'),api=require(path.join(root,'spatial-awareness.js'));
const range={status:'echo',mount:'head',beamDistanceMm:356,ageMs:90};
const pair={at:1000,range,camera:'front',forwardCamera:'front',cameraGeneration:1,headGeneration:1,headPose:'center',epoch:1,moving:false,
 visual:{target:'person in a white shirt',centered:true,occluded:false,ambiguous:false}};
const current={now:2000,range,camera:'front',cameraGeneration:1,headGeneration:1,headPose:'center',epoch:1,moving:false};
assert.equal(api.associate(pair,current).distanceMm,356);assert.equal(api.associate(pair,current).status,'likely');assert.equal(api.associate(pair,current).identityVerified,false);
for(const change of [{now:12000},{now:999},{camera:'back'},{headGeneration:2},{headPose:'turned'},{epoch:2},{moving:true},
 {range:{...range,status:'no_echo'}},{range:{...range,ageMs:2000}},{range:{...range,beamDistanceMm:900}}])assert.equal(api.associate(pair,{...current,...change}),null,JSON.stringify(change));
for(const change of [{centered:false},{ambiguous:true},{occluded:true},{target:''}])assert.equal(api.associate({...pair,visual:{...pair.visual,...change}},current),null);
assert.equal(api.associate({...pair,forwardCamera:'back'},current),null);
assert.equal(api.associate({...pair,range:{...range,mount:'unconfirmed'}},current),null);
for(const q of ['How far away am I?','What is fourteen inches away?','What is in front of you?','How close is the box?'])assert(api.targetQuestion(q),q);
assert(!api.targetQuestion('Tell me a joke'));
for(const q of ['Pair a fresh range only if it plausibly belongs to that object.',
 'Check the range reading again.','Use the sensor echo.','Match the echo to the object.'])assert(api.targetQuestion(q),q);
for(const q of ['What is your vocal range?','Play a song in my range.','Why do mountains echo?'])assert(!api.targetQuestion(q),q);
const html=fs.readFileSync(path.join(root,'growbot-brain.html'),'utf8');
const b={OwlSpatial:api};vm.createContext(b);
vm.runInContext(html.slice(html.indexOf('function userNeedsFreshVision('),html.indexOf('function cachedVisionReport(')),b);
assert(b.userNeedsFreshVision('How far away am I?'));
assert.match(html,/rangePair=rangeQuestion/);assert.match(html,/spatialAcceptVisualReport\(report,rangePair\)/);
console.log('PASS approximate camera/range pairing; stale, moving, different view, changed distance and ambiguous/occluded target rejection; distance questions refresh vision.');
