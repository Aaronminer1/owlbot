/* The Pico owns the calibrated front-leg/head bow and rise. An acceptance
 * ACK is not completion: verify the same run reaches its completed phase.
 * No calibration writes, command replay, or physical-position claims. */
const BODY_BOW={active:false};
async function runPicoBow(){
  if(BODY_BOW.active)return 'Bow failed: another bow is already running';
  if(!isDog6()||S.sim)return 'Bow unavailable: requires the calibrated Pico body';
  if(APP.resting||APP.settings)return 'Bow paused while asleep or in Settings';
  if(!MIND.motionArmed||!motorControlAvailable())return 'Bow paused: body motor control is off';
  if(!MIND.gazeArmed)return 'Bow paused: Gaze is disabled in Controls';
  if(separateHead())return 'Bow unavailable: this routine requires the head on the same Pico';
  if(NW.running||NW.checkingPath||HEAD.explicitMoves||CHANNEL_SETUP.busy||CHANNEL_SETUP.live||WALK_STREAM.session?.active)
    return 'Bow deferred: another movement or calibration owns the body';
  BODY_BOW.active=true;HEAD.explicitMoves++;
  const generation=BODY_COMMAND_LANE.generation;
  let dispatched=false;
  const check=()=>{
    if(generation!==BODY_COMMAND_LANE.generation||APP.resting||APP.settings||!bodyControllerReady()||
       !MIND.motionArmed||!MIND.gazeArmed||!motorControlAvailable())throw Error('interrupted; no automatic replay');
  };
  const request=async message=>{
    check();const ack=await sendAcknowledgedBodyCommand(message,3000,'Pico bow');check();
    if(!ack||!ack.ok)throw Error(ack?.err||'controller did not acknowledge');
    return ack;
  };
  try{
    const info=await request({t:'dog_cal',channel_action:'info'});
    if(info.saved_body_command?.bow_implementation!=='front-head-bow-v1')throw Error('Pico bow firmware is not available');
    if(info.named_walk?.running||info.named_turn?.running||info.saved_body_command?.active||
       info.stock_pose?.active||info.channel_state?.active!=null||info.channel_state?.queued)
      throw Error('another controller movement is active');
    HEAD.attentionMode='hold';HEAD.generation++;$('#headLiveEnabled').checked=false;
    dispatched=true; // An ACK timeout must never trigger a second bow.
    const accepted=await request({t:'routine',name:'take a bow',mode:'replace'});
    const run=accepted.saved_body_command?.run_id;
    if(!Number.isFinite(run))throw Error('missing bow run ID');
    const deadline=Date.now()+11000;
    while(Date.now()<deadline){
      // Large diagnostic packets can disturb cooperative servo timing.
      await new Promise(resolve=>setTimeout(resolve,750));
      const state=(await request({t:'dog_cal',channel_action:'info'})).saved_body_command;
      if(state?.run_id!==run||state.last!=='take a bow'||state.error)throw Error(state?.error||'bow replaced or interrupted');
      if(state.active)continue;
      if(!state.completed||state.bow?.phase!=='completed')throw Error('bow did not finish its rise');
      return 'Pico completed the bow and rise within saved calibration; physical movement is not measured.';
    }
    throw Error('bow completion timed out');
  }catch(error){
    if(dispatched&&generation===BODY_COMMAND_LANE.generation&&bodyControllerReady())
      await sendAcknowledgedBodyCommand({t:'stop'},2000,'stop unconfirmed bow');
    return 'Bow failed: '+error.message;
  }finally{HEAD.explicitMoves--;HEAD.faceSuppressedUntil=Date.now()+7000;BODY_BOW.active=false;}
}
