/* Conversation ownership and delivery bookkeeping. Never sends motor commands. */
function humanConversationOwnsResources(){
  if(typeof identityEnrollmentActive==='function'&&identityEnrollmentActive())return true;
  // Active locomotion also owns inference; conversation can still enter its user lane.
  if(typeof NW!=='undefined'&&NW.running)return true;
  const hearing=typeof EARS!=='undefined'&&(EARS.on||['hearing','transcribing'].includes(EARS.handsFreeState));
  return Boolean(MIND.activeUserTurn||MIND.pendingUser||MIND.userQueue?.length||hearing||
    // A conversational pause is room for a reply, not an immediate invitation
    // for old visual investigations to consume the next model slot.
    (typeof VOICE!=='undefined'&&VOICE.busy)||Date.now()-(MIND.lastHumanInputAt||0)<45000);
}
function markHumanActivity(){
  MIND.lastHumanInputAt=Date.now();
  if(MIND.abort&&!MIND.activeUserTurn)MIND.abort.abort();
  if(typeof PERCEPTION!=='undefined')PERCEPTION.abort?.abort();
  if(typeof BACKGROUND!=='undefined')for(const controller of BACKGROUND.running.values())controller.abort();
}
function inputDelivery(status,detail,request=MIND.activeRequest){
  const event={id:request?.id||null,status,detail,at:Date.now()};
  MIND.lastDelivery=event;
  MIND.deliveryHistory=(MIND.deliveryHistory||[]).concat(event).slice(-24);
  const el=$('#inputDelivery');if(el)el.textContent=(event.id?'Message '+event.id+': ':'')+detail;
  if(request)request.status=status;
}
function beginHumanDelivery(text){
  if(!MIND.activeRequest||MIND.activeRequest.text!==text)
    MIND.activeRequest={id:++MIND.userSequence,text,source:'voice',firstAttemptAt:Date.now(),attempts:0};
  const request=MIND.activeRequest;
  request.firstAttemptAt=request.firstAttemptAt||Date.now();request.attempts=(request.attempts||0)+1;
  inputDelivery('processing','Thinking'+(request.attempts>1?' — retry '+(request.attempts-1):''),request);
}
function finishHumanDelivery(status,detail){
  inputDelivery(status,detail);
  const request=MIND.activeRequest;
  if(status==='failed'&&request){
    MIND.failedRequests=(MIND.failedRequests||[]).concat({...request}).slice(-8);
    const draft=$('#typeIn');if(request.source==='typed'&&draft&&!draft.value)draft.value=request.text;
  }
  MIND.activeRequest=null;
}
function retryHumanDelivery(text,error){
  const request=MIND.activeRequest||{id:++MIND.userSequence,text,firstAttemptAt:Date.now(),attempts:1};
  MIND.activeRequest=request;
  const delay=error.name==='ModelRateDeferred'?Math.max(3000,Number(error.retryAfterMs)||30000):3000*Math.pow(2,Math.max(0,request.attempts-1));
  clearTimeout(MIND.userTimer);MIND.userTimer=null;
  if(request.sideEffects||request.attempts>=3||Date.now()+delay-request.firstAttemptAt>=120000){
    MIND.pendingUser=null;MIND.rateRetryAt=0;
    const reason=request.sideEffects?'Reply interrupted after an action; it will not be replayed.':'Could not get a reply after bounded retries. Please retry when the connection is ready.';
    finishHumanDelivery('failed',reason);mindLog(reason,'w');
    if(!APP.resting&&!APP.settings&&typeof say==='function')
      say(request.sideEffects?"I couldn't finish the reply after that action. I won't repeat the action.":"My connection got stuck, so I couldn't finish your answer. Please try again.");
    return false;
  }
  MIND.pendingUser=text;MIND.rateRetryAt=Date.now()+delay;
  inputDelivery('retrying','Waiting '+Math.ceil(delay/1000)+'s to retry; your message is retained.',request);
  MIND.userTimer=setTimeout(()=>{MIND.userTimer=null;if(MIND.on&&!APP.resting&&!APP.settings&&MIND.pendingUser)mindTick();},delay);
  return true;
}
async function waitForHumanSpeechBeforePlayback(generation){
  const started=Date.now();
  while(EARS.on||['hearing','transcribing'].includes(EARS.handsFreeState)){
    if(generation!==VOICE.generation||APP.resting||Date.now()-started>45000)throw Error('cancelled for human speech');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(generation!==VOICE.generation||APP.resting)throw Error('cancelled before playback');
}
