/* Consent-first, local SFace identity. Names are not face verification.
 * Transient descriptors are never put into conversation/model context. */
const FACE_MEMORY_KEY='owlbot_face_memory_v4',FACE_RECOGNITION_KEY='owlbot_face_recognition_enabled_v1';
const FACE_ENGINE='sface-2021dec-v1';
const IDENT={enabled:false,profiles:[],legacyCount:0,currentId:null,currentName:null,currentConfidence:0,
 sessionName:null,sessionSelfReported:false,lastVerified:0,candidateId:null,candidateStreak:0,unknownStreak:0,
 lastObserve:0,lastDescriptor:null,lastDescriptorAt:0,lastRealFaceAt:0,faceCount:0,quality:'not_started',error:'',engineMs:0,
 greetedPresence:false,askTimer:null,awaitingName:false,awaitingConsent:false,pendingName:null,enrolling:null,
 enrollmentGraceUntil:0,onboardingExpiresAt:0,reaskAfter:0,claimedProfileId:null,claimExpiresAt:0,
 consentAnchor:null,consent:null,generation:0,requestSeq:0,pending:new Map(),lastGuidanceAt:0};
let fdBusy=false,lastFaceDetectAt=0,faceDetector=null;
let primaryCameraReturnTimer=null;
function schedulePrimaryCameraReturn(){
 clearTimeout(primaryCameraReturnTimer);
 const restore=()=>{
  if(APP.resting||APP.settings||S.cameraFacing!=='back')return;
  // Never change the camera under an in-flight look or walking supervisor.
  if(MIND.busy||PERCEPTION.busy||NW.running||(typeof walkingStreamStatus==='function'&&walkingStreamStatus().active)){
   primaryCameraReturnTimer=setTimeout(restore,1000);return;
  }
  enableCamera('front');
 };
 primaryCameraReturnTimer=setTimeout(restore,15000);
}
const fdCanvas=document.createElement('canvas'),fdCtx=fdCanvas.getContext('2d',{willReadFrequently:true});
fdCanvas.width=640;fdCanvas.height=480;
if('FaceDetector' in window)try{faceDetector=new FaceDetector({fastMode:true,maxDetectedFaces:2});}catch(e){}
function validFaceVector(v){return Array.isArray(v)&&v.length===128&&v.every(Number.isFinite)&&Math.abs(Math.hypot(...v)-1)<.02;}
function validFaceProfile(p){return Boolean(p&&typeof p.id==='string'&&typeof p.personKey==='string'&&typeof p.name==='string'&&p.name.length<=60&&p.engine===FACE_ENGINE&&p.consent?.granted===true&&Array.isArray(p.templates)&&p.templates.length>=8&&p.templates.length<=12&&p.templates.every(validFaceVector));}
function faceLoad(){
 try{
  const saved=JSON.parse(localStorage.getItem(FACE_MEMORY_KEY)||'null');
  IDENT.profiles=(saved?.profiles||[]).filter(validFaceProfile).slice(-40);
  IDENT.legacyCount=(JSON.parse(localStorage.getItem('owlbot_face_memory_v3')||'null')?.profiles||[]).length;
  IDENT.enabled=localStorage.getItem(FACE_RECOGNITION_KEY)==='true';
 }catch(e){IDENT.error='Saved profiles could not be read.';}
 refreshFaceUI();
}
function faceSave(){
 try{localStorage.setItem(FACE_MEMORY_KEY,JSON.stringify({version:4,engine:FACE_ENGINE,profiles:IDENT.profiles}));}
 catch(e){IDENT.error='Face memory could not be saved. Free phone storage and try again.';refreshFaceUI();return false;}
 refreshFaceUI();return true;
}
function refreshFaceUI(){
 const el=$('#faceOut');if(!el)return;
 const current=verifiedIdentity(),e=IDENT.enrolling;
 const engineAvailable=Boolean(NATIVE?.analyzeLocalFace);
 const guidance={not_started:'Waiting for a face frame.',no_face:'Look toward the active camera.',one_person_only:'One person at a time, please.',closer_and_centered:'Move a little closer and keep your whole face in view.',face_camera:'Look toward the camera.',hold_still_more_light:'Hold still in better light.',good:'Face image is usable.'};
 el.textContent=(!engineAvailable?'Face recognition engine is not bundled in this community edition. Saved profiles are retained; forgetting remains available.':IDENT.enabled?(current?'Recognized: '+current.name:'Recognition on; identity unknown'):'Recognition off')+
  '\n'+(IDENT.error||guidance[IDENT.quality]||IDENT.quality)+'\nSaved consented profiles: '+IDENT.profiles.length+
  (IDENT.engineMs?' · local inference '+IDENT.engineMs+' ms':'')+
  (IDENT.legacyCount?'\n'+IDENT.legacyCount+' old pixel-based profiles need fresh enrollment; they are not used for matching.':'')+
  (IDENT.awaitingName?'\nAndrew is waiting for your name.':'')+
  (IDENT.awaitingConsent?'\nWaiting for '+IDENT.pendingName+' to say: Yes, remember my face.':'')+
  (e?'\nLearning '+e.name+': '+e.samples.length+' / 8 views':'');
 const toggle=$('#btnFaceRecognition');if(toggle){toggle.textContent='Recognition: '+(IDENT.enabled?'on':'off');toggle.disabled=!engineAvailable&&!IDENT.enabled;toggle.classList.toggle('primary',IDENT.enabled);}
 const enroll=$('#btnEnrollFace');if(enroll)enroll.disabled=!IDENT.enabled||!engineAvailable;
 const select=$('#faceProfileSelect');if(select){const value=select.value;select.replaceChildren();for(const p of IDENT.profiles){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;select.appendChild(o);}select.value=value||IDENT.profiles[0]?.id||'';}
 const forget=$('#btnForgetFace');if(forget)forget.disabled=!IDENT.profiles.length;
}
function clearFaceVerification(){
 IDENT.currentId=null;IDENT.currentName=null;IDENT.currentConfidence=0;IDENT.lastVerified=0;
 IDENT.candidateId=null;IDENT.candidateStreak=0;MEM.currentPerson=null;
 if(!IDENT.awaitingConsent){IDENT.sessionName=null;IDENT.sessionSelfReported=false;}
}
function cancelFaceEnrollment(reason='',announce=false){
 IDENT.awaitingName=false;IDENT.awaitingConsent=false;IDENT.pendingName=null;IDENT.enrolling=null;
 IDENT.consentAnchor=null;IDENT.consent=null;IDENT.onboardingExpiresAt=0;
 clearTimeout(IDENT.askTimer);IDENT.askTimer=null;
 if(reason){IDENT.reaskAfter=now()+120000;IDENT.greetedPresence=true;}
 if(announce&&reason&&!APP.resting)say(reason);
 refreshFaceUI();
}
function identityEnrollmentActive(){return Boolean(IDENT.enabled&&(IDENT.awaitingName||IDENT.awaitingConsent||IDENT.enrolling));}
function setFaceRecognitionEnabled(enabled,announce){
 IDENT.enabled=Boolean(enabled);IDENT.generation++;
 localStorage.setItem(FACE_RECOGNITION_KEY,String(IDENT.enabled));
 cancelFaceEnrollment();clearFaceVerification();IDENT.lastDescriptor=null;IDENT.lastDescriptorAt=0;IDENT.faceCount=0;
 IDENT.greetedPresence=false;IDENT.reaskAfter=0;IDENT.unknownStreak=0;
 if(IDENT.enabled&&(!S.camOK||S.cameraFacing!=='front'))enableCamera('front');
 refreshFaceUI();if(announce)say(IDENT.enabled?'Face recognition is on. I will ask before saving a new face.':'Face recognition is off. Saved face profiles are kept until you delete them.');
}
function faceSimilarity(a,b){
 if(!validFaceVector(a)||!validFaceVector(b))return -1;
 let dot=0;for(let i=0;i<a.length;i++)dot+=a[i]*b[i];return dot;
}
function profileFaceScore(p,desc){
 if(!validFaceProfile(p)||!validFaceVector(desc))return -1;
 const scores=p.templates.map(v=>faceSimilarity(v,desc)).sort((a,b)=>b-a).slice(0,3);
 return scores.reduce((a,b)=>a+b,0)/scores.length;
}
function matchFace(desc){
 const ranked=IDENT.profiles.filter(validFaceProfile).map(profile=>({profile,score:profileFaceScore(profile,desc)})).sort((a,b)=>b.score-a.score);
 // Conservative starting point, NOT a calibrated probability or a security credential.
 if(!ranked.length||ranked[0].score<.55||(ranked[1]&&ranked[0].score-ranked[1].score<.10))return null;
 return ranked[0];
}
function verifiedIdentity(){
 if(!IDENT.enabled||IDENT.faceCount!==1||!IDENT.currentId||now()-IDENT.lastVerified>3500)return null;
 return IDENT.profiles.find(p=>p.id===IDENT.currentId&&validFaceProfile(p))||null;
}
function setCurrentIdentity(profile,score){
 if(!validFaceProfile(profile))return;
 const changed=IDENT.currentId!==profile.id;
 IDENT.currentId=profile.id;IDENT.currentName=profile.name;IDENT.currentConfidence=score;IDENT.lastVerified=now();
 IDENT.sessionName=profile.name;IDENT.sessionSelfReported=false;
 IDENT.awaitingName=false;IDENT.awaitingConsent=false;IDENT.pendingName=null;IDENT.onboardingExpiresAt=0;
 IDENT.reaskAfter=now()+120000;clearTimeout(IDENT.askTimer);IDENT.askTimer=null;
 MEM.currentPerson=profile.personKey;
 if(!MEM.people[profile.personKey])MEM.people[profile.personKey]={name:profile.name,met:Date.now(),seen:Date.now(),times:0,notes:[],feeling:.6};
 const person=MEM.people[profile.personKey],stamp=Date.now(),newVisit=stamp-(profile.lastSeen||0)>30000;
 // Refresh last-seen on EVERY match, not only reacquisition. Otherwise a long
 // continuous encounter followed by one missed frame looks like a new visit.
 person.seen=stamp;profile.lastSeen=stamp;
 if(changed){if(newVisit)person.times++;profile.matches=(profile.matches||0)+1;memSave();faceSave();}
 // Recognition is silent state, not a greeting event. Never interrupt speech,
 // overwrite contextual affect, or chirp when a familiar face is reacquired.
 // This flag only prevents an unnecessary introduction to a known person.
 IDENT.greetedPresence=true;
 refreshFaceUI();
}
function faceConsentAnswer(text){
 const t=String(text||'').trim().toLowerCase().replace(/[.!?,]/g,'').replace(/\s+/g,' ');
 if(/\b(?:no|nope|not|don't|do not|stop|cancel|forget)\b/.test(t))return false;
 return /^(?:yes[ ,]*)?(?:please )?(?:remember my face|you may (?:remember|save|store) my face|i consent to (?:remembering|saving|storing) my face)$/.test(t)?true:null;
}
function cleanPersonName(text,allowBare){
 let t=String(text||'').trim().replace(/[.!?,]+$/g,'');
 const m=t.match(/^(?:my name is|call me|i am called|i'm called|i am|i'm)\s+(.+)$/i);
 if(m)t=m[1].trim();else if(!allowBare)return '';
 if(!/^[\p{L}][\p{L}\p{M}' -]{0,59}$/u.test(t)||t.split(/\s+/).length>4)return '';
 if(/^(?:yes|no|nope|maybe|sure|okay|ok|hello|hi|stop|cancel|thanks|thank you|remember me)$/i.test(t))return '';
 if(/^(?:who|what|why|how|when|where|can|do|did|will|would|are|is)\b/i.test(t))return '';
 return t.split(/\s+/).map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
}
function knownProfileForName(name){return IDENT.profiles.find(p=>p.name.toLowerCase()===String(name||'').toLowerCase())||null;}
function repairIdentityAliases(){return 0;} // Never merge people based on similar names.
function askUnknownPerson(){
 if(!IDENT.enabled||APP.resting||APP.settings||needsAgentOnboarding()||verifiedIdentity()||identityEnrollmentActive()||IDENT.faceCount!==1||!IDENT.lastDescriptor||now()-IDENT.lastDescriptorAt>3000||now()<IDENT.reaskAfter||IDENT.greetedPresence)return;
 if(IDENT.unknownStreak<3||MIND.busy||VOICE.busy||EARS.on||['hearing','transcribing'].includes(EARS.handsFreeState))return;
 IDENT.awaitingName=true;IDENT.greetedPresence=true;IDENT.onboardingExpiresAt=now()+90000;
 if(typeof PERCEPTION!=='undefined')PERCEPTION.abort?.abort();
 say('Hi, I’m '+(BEING.identity.name||'Andrew')+'. I don’t think we’ve met. What should I call you?');refreshFaceUI();
}
function requestFaceConsent(name){
 name=cleanPersonName(name,true);if(!name)return false;
 if(IDENT.faceCount!==1||!IDENT.lastDescriptor||now()-IDENT.lastDescriptorAt>3000){say('Please look toward the active camera, one person at a time, then tell me your name.');return false;}
 if(knownProfileForName(name)){
  cancelFaceEnrollment();IDENT.reaskAfter=now()+60000;
  say('I already have a profile called '+name+', but I have not verified a match. I will not overwrite it or assume you are the same person. If it needs replacing, remove that face profile in Settings first.');return false;
 }
 IDENT.awaitingName=false;IDENT.awaitingConsent=true;IDENT.pendingName=name;IDENT.consentAnchor=IDENT.lastDescriptor.slice();
 IDENT.onboardingExpiresAt=now()+90000;IDENT.sessionName=name;IDENT.sessionSelfReported=true;MEM.currentPerson=null;
 say('Nice to meet you, '+name+'. May I save a face template on this phone so I can recognize you next time? You can ask me to forget it. If you agree, say: yes, remember my face.');refreshFaceUI();return true;
}
function beginFaceEnrollment(name){
 const fresh=IDENT.faceCount===1&&validFaceVector(IDENT.lastDescriptor)&&now()-IDENT.lastDescriptorAt<3000;
 if(!IDENT.enabled||!IDENT.consent?.granted||IDENT.consent.name!==name||now()-IDENT.consent.at>5000||!fresh||faceSimilarity(IDENT.consentAnchor,IDENT.lastDescriptor)<.55)return false;
 IDENT.awaitingConsent=false;IDENT.awaitingName=false;
 IDENT.enrolling={id:'face-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),name,samples:[],anchor:IDENT.consentAnchor.slice(),consent:{...IDENT.consent},lastSample:0};
 IDENT.onboardingExpiresAt=now()+45000;IDENT.lastGuidanceAt=now();
 say('Thanks, '+name+'. Look toward me for a moment. I’ll collect a few clear views; you can say stop at any time.');refreshFaceUI();return true;
}
function finishFaceEnrollment(){
 const e=IDENT.enrolling;if(!e||e.samples.length<8||!e.consent?.granted||e.samples.some(v=>!validFaceVector(v)||faceSimilarity(e.anchor,v)<.55))return false;
 const p={id:e.id,personKey:e.id,name:e.name,engine:FACE_ENGINE,created:Date.now(),lastSeen:0,matches:0,consent:{granted:true,at:Date.now(),method:e.consent.method,scope:'local face template; removable'},templates:e.samples.slice(0,8)};
 IDENT.profiles.push(p);
 if(!faceSave()){IDENT.profiles.pop();cancelFaceEnrollment('I could not save the face memory. Please try again after checking phone storage.',true);return false;}
 cancelFaceEnrollment();clearFaceVerification();IDENT.greetedPresence=true;IDENT.reaskAfter=now()+120000;
 // Enrollment is NOT an independent recognition test. Require new frames to match.
 say('Your face template is saved, '+p.name+'. Now look away for a moment and look back so I can check whether I recognize you.');return true;
}
function forgetFaceProfile(id){
 const profile=IDENT.profiles.find(p=>p.id===id);if(!profile)return false;
 const before=IDENT.profiles;IDENT.profiles=before.filter(p=>p.id!==id);
 if(!faceSave()){IDENT.profiles=before;return false;}
 cancelFaceEnrollment();clearFaceVerification();IDENT.lastDescriptor=null;IDENT.lastDescriptorAt=0;IDENT.reaskAfter=now()+300000;
 say('I deleted '+profile.name+'’s face template. Conversation memories are separate and have not been deleted.');refreshFaceUI();return true;
}
function handleIdentityReply(text){
 if(!IDENT.enabled||APP.resting)return false;
 const raw=String(text||'').trim();
 if(/^\s*(?:please )?(?:forget|delete|remove) my face(?: (?:template|profile))?[.!]?\s*$/i.test(raw)){
  const p=verifiedIdentity();if(p)forgetFaceProfile(p.id);else say('I cannot verify which profile is yours right now. Please select your profile under Face recognition in Settings and choose Forget selected face.');return true;
 }
 if(identityEnrollmentActive()&&/\b(?:stop|cancel|no|nope|do not|don't|rather not)\b/i.test(raw)){cancelFaceEnrollment('Okay. I won’t save your face.',true);return true;}
 if(IDENT.awaitingConsent){
  const consent=faceConsentAnswer(raw);
  if(consent===false){cancelFaceEnrollment('Okay. I won’t save your face.',true);return true;}
  if(consent===true){IDENT.consent={granted:true,name:IDENT.pendingName,at:now(),method:'explicit response to local face permission question'};
   if(!beginFaceEnrollment(IDENT.pendingName))cancelFaceEnrollment('I lost the clear view of you. No face was saved. Let’s try the introduction again when you’re in view.',true);return true;}
  say('Only if you want to: say yes, remember my face, or say no.');return true;
 }
 if(IDENT.awaitingName){const name=cleanPersonName(raw,true);if(name)requestFaceConsent(name);else say('What name should I call you? You can also say cancel.');return true;}
 const explicit=cleanPersonName(raw,false);if(explicit&&!verifiedIdentity()){requestFaceConsent(explicit);return true;}
 return false;
}
function identityObserve(result){
 if(!IDENT.enabled||APP.resting||APP.settings)return;
 IDENT.faceCount=Number(result.count)||0;IDENT.quality=result.quality||'no_face';IDENT.engineMs=Number(result.elapsedMs)||0;IDENT.error='';
 if(IDENT.faceCount!==1){
  clearFaceVerification();IDENT.lastDescriptor=null;IDENT.lastDescriptorAt=0;
  // A blink, brief occlusion or a dropped detector frame pauses collection.
  // Keep the consent anchor; the returning face must still match it.
  if(identityEnrollmentActive()&&(IDENT.faceCount>1||now()-IDENT.lastRealFaceAt>6000))cancelFaceEnrollment(IDENT.faceCount>1?'I see more than one person. No face was saved. Let’s try one person at a time.':'I lost sight of you. No face was saved; we can try again when you return.',true);
  refreshFaceUI();return;
 }
 if(result.engine!==FACE_ENGINE||result.quality!=='good'||!validFaceVector(result.embedding)){
  IDENT.candidateId=null;IDENT.candidateStreak=0;IDENT.lastDescriptor=null;IDENT.lastDescriptorAt=0;
  if(now()-IDENT.lastVerified>3500)clearFaceVerification();
  if(IDENT.enrolling&&now()-IDENT.lastGuidanceAt>10000){IDENT.lastGuidanceAt=now();say(result.quality==='face_camera'?'Look toward me a little more.':'A little closer and steadier, please. I need a clear view.');}
  refreshFaceUI();return;
 }
 const desc=result.embedding;IDENT.lastObserve=now();IDENT.lastRealFaceAt=now();IDENT.lastDescriptor=desc;IDENT.lastDescriptorAt=now();
 if(IDENT.awaitingConsent&&faceSimilarity(IDENT.consentAnchor,desc)<.55){cancelFaceEnrollment('The person in view changed. No face was saved. Please introduce yourself again.',true);clearFaceVerification();return;}
 if(IDENT.enrolling){
  const e=IDENT.enrolling;if(faceSimilarity(e.anchor,desc)<.55){cancelFaceEnrollment('I lost track of the person who agreed. No face was saved. Let’s restart the introduction.',true);return;}
  if(now()-e.lastSample>=1000){e.samples.push(desc.slice());e.lastSample=now();}
  if(e.samples.length===4&&now()-IDENT.lastGuidanceAt>3000){IDENT.lastGuidanceAt=now();say('Good. Turn your face just a little, then look back toward me.');}
  if(e.samples.length>=8)finishFaceEnrollment();refreshFaceUI();return;
 }
 const match=matchFace(desc);
 if(match){
  IDENT.unknownStreak=0;
  if(IDENT.currentId&&IDENT.currentId!==match.profile.id)clearFaceVerification();
  if(IDENT.candidateId===match.profile.id)IDENT.candidateStreak++;else{IDENT.candidateId=match.profile.id;IDENT.candidateStreak=1;}
  if(IDENT.candidateStreak>=3)setCurrentIdentity(match.profile,match.score);
 }else{
  clearFaceVerification();IDENT.unknownStreak++;
  if(IDENT.unknownStreak===1&&!IDENT.greetedPresence&&now()>=IDENT.reaskAfter){
   // A new introduction owns the social moment, not the old solo mission.
   if(typeof markHumanActivity==='function')markHumanActivity();
  }
  askUnknownPerson();
 }
 refreshFaceUI();
}
window.onLocalFaceResult=raw=>{
 let r;try{r=typeof raw==='string'?JSON.parse(raw):raw;}catch(e){return;}
 const pending=IDENT.pending.get(r?.id);if(!pending)return;IDENT.pending.delete(r.id);clearTimeout(pending.timer);pending.resolve(r);
};
function requestLocalFace(dataUrl){
 return new Promise((resolve,reject)=>{const id='face-'+(++IDENT.requestSeq)+'-'+Date.now();
  const timer=setTimeout(()=>{IDENT.pending.delete(id);reject(Error('Local face engine timed out'));},8000);
  IDENT.pending.set(id,{resolve,timer});try{NATIVE.analyzeLocalFace(id,dataUrl);}catch(e){clearTimeout(timer);IDENT.pending.delete(id);reject(e);}
 });
}
async function detectFaceNative(){
 if(APP.resting||APP.settings||thermalModerate()||fdBusy||!S.camOK)return false;
 if(NW.running||(typeof walkingStreamStatus==='function'&&walkingStreamStatus().active))return true;
 if(IDENT.enabled&&S.cameraFacing!=='front'){clearFaceVerification();IDENT.lastDescriptor=null;IDENT.lastDescriptorAt=0;IDENT.quality='Recognition paused while looking behind.';refreshFaceUI();return true;}
 if(now()-lastFaceDetectAt<1500)return true;
 const video=$('#vid');if(!video||video.readyState<2||!video.videoWidth)return false;
 lastFaceDetectAt=now();fdBusy=true;const generation=IDENT.generation,facing=S.cameraFacing;
 try{
  const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
  fdCanvas.width=Math.round(video.videoWidth*scale);fdCanvas.height=Math.round(video.videoHeight*scale);
  fdCtx.drawImage(video,0,0,fdCanvas.width,fdCanvas.height);
  if(IDENT.enabled){
   if(!NATIVE?.analyzeLocalFace){IDENT.error='Local face-recognition engine is unavailable in this build.';refreshFaceUI();return false;}
   const result=await requestLocalFace(fdCanvas.toDataURL('image/jpeg',.85));
   if(generation!==IDENT.generation||!IDENT.enabled||APP.resting||APP.settings||facing!==S.cameraFacing)return true;
   if(result.error)throw Error(result.error);identityObserve(result);
   if(result.count===1)markSeen(result.x+result.width/2,result.y+result.height/2,result.width,result.confidence,'native-face');
   return true;
  }
  // Presence only: these detectors never create identity templates.
  if(NATIVE?.detectFace){const r=JSON.parse(NATIVE.detectFace(fdCanvas.toDataURL('image/jpeg',.5)));if(r.found)markSeen(r.x+r.width/2,r.y+r.height/2,r.width,r.confidence,'native-face');return true;}
  if(faceDetector){const faces=await faceDetector.detect(fdCanvas);if(faces.length){const b=faces[0].boundingBox;markSeen((b.x+b.width/2)/fdCanvas.width,(b.y+b.height/2)/fdCanvas.height,b.width/fdCanvas.width,1,'facedetector');}return true;}
 }catch(e){IDENT.error=String(e.message||e);clearFaceVerification();refreshFaceUI();}
 finally{fdBusy=false;}
 return false;
}
setInterval(()=>{
 if(identityEnrollmentActive()&&(APP.resting||APP.settings||now()>IDENT.onboardingExpiresAt))cancelFaceEnrollment('The face introduction paused or timed out. No face was saved.',!APP.resting&&!APP.settings);
 if(IDENT.currentId&&now()-IDENT.lastVerified>3500){clearFaceVerification();refreshFaceUI();}
 if(!APP.resting&&!APP.settings&&IDENT.enabled&&!identityEnrollmentActive()&&!verifiedIdentity())askUnknownPerson();
},1000);
