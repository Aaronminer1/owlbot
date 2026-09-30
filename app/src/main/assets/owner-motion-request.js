/* A human's current movement instruction is separate from motor authority.
 * Head-only conversation must not silently become a body turn or a walk.
 * No new obstacle, heat, distance, or per-step permission gate lives here. */
const OWNER_MOTION_KEY='owlbot_owner_feet_hold_v1';
const OWNER_MOTION={feetStill:false,changedAt:0};
let ownerMotionLastText='',ownerMotionLastAt=0;
try{const saved=JSON.parse(localStorage.getItem(OWNER_MOTION_KEY)||'null');if(saved?.feetStill===true){OWNER_MOTION.feetStill=true;OWNER_MOTION.changedAt=Number(saved.changedAt)||0;}}catch(e){}
function ownerMotionDirective(text){
  // Reported speech and questions ABOUT instructions are not instructions.
  const plain=String(text||'').replace(/[“"][^”"]*[”"]/g,' ').replace(/[’]/g,"'");
  const clauses=plain.split(/(?:[.!?;\n]+|\bthen\b)/i).map(s=>s.trim().replace(/^(?:andrew|aspen|owlbot)[, ]+/i,'').replace(/^please\s+/i,''));
  const hold=/^(?:(?:for now|this time),?\s+)?(?:(?:keep|leave)\s+(?:your\s+|the\s+)?(?:feet|legs|body)\s+(?:still|stationary)|(?:only|just)\s+(?:move|turn)\s+your\s+head)\b/i;
  const noBody=/^(?:don't|do not)\s+(?:walk|move\s+(?:your\s+|the\s+)?(?:feet|legs|body)|turn\s+(?:your\s+|the\s+)?body)(?:\s+(?:now|yet|for now|at all))?(?:$|\s*,|\s+(?:until|unless)\b)/i;
  // "Don't walk into the wall" constrains a route; it is NOT a feet hold.
  if(clauses.some(c=>hold.test(c)||noBody.test(c)))return 'hold';
  const resume=/^(?:(?:okay|ok|now)[, ]+)?(?:(?:please|can you|could you|you can|you may|I want you to|I'd like you to|go ahead and)\s+)?(?:(?:walk|drive|move)\s+(?:forward|backward|backwards|ahead)|(?:turn|rotate)\s+(?:your body\s+)?(?:left|right)|(?:go|continue|resume|keep)\s+explor(?:e|ing|ation)|(?:resume|continue|start|keep)\s+walking|(?:back up|bow|take a bow|wiggle)(?:\s|$)|(?:move|turn)\s+your\s+body\b)/i;
  if(clauses.some(c=>resume.test(c)))return 'resume';
  return null;
}
function ownerMotionSnapshot(){return {feetStill:OWNER_MOTION.feetStill,changedAt:OWNER_MOTION.changedAt,
  instruction:OWNER_MOTION.feetStill?'Keep feet/body still. Head looks, camera, conversation and Stop remain available. A new explicit owner body-movement request clears this hold.':'No stationary-body request. Normal exploration authority applies.'};}
function ownerBodyMotionProblem(){return OWNER_MOTION.feetStill?'Not executed: the owner asked to keep feet/body still. Use head-only look_at or conversation; wait for a new owner body-movement request.':'';}
function ownerMotionToolProblem(name,args={}){
  if(!OWNER_MOTION.feetStill)return '';
  const body=['move','start_walking','gesture','perform_body_sequence','test_body_output','test_servo','move_named_servos'];
  if(!body.includes(name))return '';
  if(name==='move_named_servos'&&typeof headNamedTarget==='function'&&headNamedTarget(args.subject,args.position))return '';
  return ownerBodyMotionProblem();
}
function acceptOwnerMotionRequest(text){
  const directive=ownerMotionDirective(text);if(!directive)return false;
  if(String(text)===ownerMotionLastText&&Date.now()-ownerMotionLastAt<250)return false;
  ownerMotionLastText=String(text);ownerMotionLastAt=Date.now();
  const held=directive==='hold',changed=held!==OWNER_MOTION.feetStill;
  OWNER_MOTION.feetStill=held;OWNER_MOTION.changedAt=Date.now();
  try{localStorage.setItem(OWNER_MOTION_KEY,JSON.stringify(OWNER_MOTION));}catch(e){}
  if(typeof refreshMotionButton==='function')refreshMotionButton();
  if(held){
    // Discard deferred leg commands, not the person's conversation queue.
    if(typeof MIND!=='undefined')MIND.directBodyQueue=[];
    const walking=typeof WALK_STREAM!=='undefined'&&WALK_STREAM.session?.active;
    if(walking)cancelWalkingSession('The owner requested feet still.');
    if(typeof NW!=='undefined'&&NW.abort)NW.abort.abort();
    if(typeof bodyControllerReady==='function'&&bodyControllerReady()){
      // Hold the current supported pose; never release the head to obey a
      // feet-only instruction. Failed stop confirmation is visible in logs.
      for(const action of ['walk_halt','turn_halt'])channelCommand(action).catch(e=>{
        if(typeof log==='function')log('Stationary request stop unconfirmed: '+e.message,'e');
      });
    }
  }
  return changed;
}
