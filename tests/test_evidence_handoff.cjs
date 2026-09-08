const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const prompts=[];
const box={Date,JSON,String,Number,Math,identityEnrollmentActive:()=>false,S:{cameraFacing:'front'},MIND:{visionReportFacing:'front'},LOCAL_VISION:{status:{thermalStatus:0}},
 cachedVisionReport:()=> 'An open yellow bucket contains tools.',localVisionRoute:()=> 'local',localVisionReady:()=>true,
 localVisionInfer:async(img,prompt)=>{prompts.push(prompt);return {text:'CHANGE: UNCERTAIN A yellow capped jug is visible. Its contents are hidden. FOCUS: 0,0,jug',backend:'gpu',latencyMs:1500};},
 log:()=>{},inquiryObserve:(report,at,facing)=>{box.observation={report,at,facing};},visualAttentionFromReport:()=>{}};
vm.createContext(box);
vm.runInContext(part('function freshInvestigationPrompt(','function perceptionTerms('),box);
vm.runInContext(part('function executiveOutcomeFallback(','function unexecutedMovementPromise('),box);
(async()=>{
 const cameraBox={MIND:{vision:false,oneShotVision:false},String,enableCamera:async()=>true,mindLog:()=>{}};
 vm.createContext(cameraBox);
 vm.runInContext('async function cameraTool(name,args){'+part('    if(name==="use_camera"){','    if(name==="look_at"){')+'}',cameraBox);
 assert.match(await cameraBox.cameraTool('use_camera',{facing:'front'}),/not visual evidence/);
 assert.equal(cameraBox.MIND.oneShotVision,true,'explicit camera analysis works when ambient vision is off');
 assert.equal(cameraBox.MIND.vision,false,'one inspection does not silently enable ambient camera processing');
 cameraBox.MIND.oneShotVision=false;cameraBox.enableCamera=async()=>false;
 await cameraBox.cameraTool('use_camera',{});assert.equal(cameraBox.MIND.oneShotVision,false,'failed capture grants no evidence');
 await box.describeFrameForBrain('','', 'image',null,'verification after the action or viewpoint change','Is the yellow object open or capped?');
 assert.match(prompts[0],/Is the yellow object open or capped/);
 assert.doesNotMatch(prompts[0],/PRIOR REPORT|contains tools/);
 assert.match(prompts[0],/Inspect only this image/);
 assert.match(prompts[0],/No coordinates, FOCUS, CHANGE/);
 assert.equal(box.observation.report,box.MIND.visionReport);
 await box.describeFrameForBrain('','','image',null,'ambient heartbeat');
 assert.match(prompts[1],/PRIOR REPORT/,'ambient change detection still compares scenes');
 box.identityEnrollmentActive=()=>true;
 await assert.rejects(box.describeFrameForBrain('','','private face frame',null,'ambient heartbeat'),/local-only/);
 assert.equal(prompts.length,2,'enrollment pixels never reach a vision provider');
 assert.match(html,/cameraText=[\s\S]*?inquiryEvidenceContext\(\)/,'post-action report carries explicit citable IDs');
 assert.doesNotMatch(html,/if\(!finalLine&&!incompleteDraft\)/,'truncation cannot suppress the final recovery attempt');
 assert.doesNotMatch(html,/I couldn't finish a reliable answer to that request/,'old blanket fallback removed');
 assert.match(box.executiveOutcomeFallback([{tool:'move',result:'I finished 2 forward walk cycle(s) and stopped with my feet down.'},{tool:'update_curiosity',result:'wonder update rejected: missing evidence'}]),/completed 2 forward.*does not establish arrival.*evidence reference/);
 assert.match(box.executiveOutcomeFallback([{tool:'look_at',result:'Pico completed head target'}]),/did not produce a verified answer/);
 assert.match(box.executiveOutcomeFallback([{tool:'update_curiosity',result:'wonder updated: open',evidence:'Its contents are hidden.'}]),/contents are hidden/);
 const spoken=[{tool:'speak',result:'Speech submitted: It looks like a closed container.'}];
 assert.equal(box.finalSpeechAfterTools('I told Aaron it looks closed and I recorded the finding.',spoken),'');
 assert.equal(box.finalSpeechAfterTools('The controller disconnected after I recorded the finding.',spoken),'The controller disconnected after I recorded the finding.');
 console.log('PASS: independent task vision, preserved ambient comparisons, explicit evidence handoff, final recovery and truthful outcome summaries.');
})().catch(e=>{console.error(e);process.exitCode=1;});
