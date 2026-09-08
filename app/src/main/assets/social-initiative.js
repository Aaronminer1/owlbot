/* Companionship uses the existing mind scheduler, never a reflection worker. */
const SOCIAL_INITIATIVE={enabled:localStorage.getItem('owlbot_social_initiative_v1')!=='off'};
function socialInitiativeEnabled(){return SOCIAL_INITIATIVE.enabled;}
function renderSocialInitiative(){
  const button=$('#btnSocialInitiative');
  if(button){button.textContent='Starts conversations: '+(socialInitiativeEnabled()?'on':'off');button.setAttribute('aria-pressed',String(socialInitiativeEnabled()));}
}
function setSocialInitiativeEnabled(enabled){
  localStorage.setItem('owlbot_social_initiative_v1',enabled?'on':'off');
  SOCIAL_INITIATIVE.enabled=Boolean(enabled);
  if(!enabled&&MIND.socialTurn)MIND.abort?.abort();
  if(enabled)MIND.nextSocialAt=now()+45000;
  renderSocialInitiative();
}
function socialPreferenceFromSpeech(text){
  const clean=String(text||'').toLowerCase().replace(/^(?:andrew|owlbot)[, ]*/,'').replace(/^please\s+/,'').replace(/[.!]+$/,'').trim();
  if(/^(?:be quiet|stop talking|quiet please|give me some quiet|don't start conversations|do not start conversations)$/.test(clean))return false;
  if(/^(?:you can talk again|start conversations again|you can start conversations|be more talkative)$/.test(clean))return true;
  return null;
}
function socialOpportunityReady(){
  if(!socialInitiativeEnabled()||!MIND.on||!MIND.voice||APP.resting||APP.settings||MIND.busy)return false;
  if(typeof humanConversationOwnsResources==='function'&&humanConversationOwnsResources())return false;
  if(typeof VOICE!=='undefined'&&(VOICE.busy||VOICE.queue.length))return false;
  return Boolean(MIND.nextSocialAt)&&now()>=MIND.nextSocialAt&&now()-MIND.lastSpoke>=45000;
}
function socialInitiativeContext(){
  const latest=MEM.conversations.slice(-1)[0];
  const recent=latest&&Date.now()-latest.t<24*60*60*1000?latest:null;
  const unanswered=MEM.initiatives.filter(x=>x.t>(latest?.t||0)&&!x.answer).length;
  return {enabled:socialInitiativeEnabled(),dueInMs:Math.max(0,(MIND.nextSocialAt||0)-now()),
    recentPerson:humanEngagementRecent(3*60*1000),unansweredStarts:unanswered,
    recentConversation:recent?{ageMinutes:Math.floor((Date.now()-recent.t)/60000),human:recent.user,andrew:recent.owl}:null,
    recentStarts:MEM.initiatives.filter(x=>Date.now()-x.t<24*60*60*1000).slice(-3).map(x=>String(x.text||'').slice(0,300)),
    presenceNote:'No recent interaction is not proof the person left, abandoned me, or is in danger.'};
}
function socialConversationPrompt(identity){
  const context=socialInitiativeContext();
  const query=context.recentConversation?.human||'shared interests and playful conversation';
  return conversationPrompt(query,identity)+
    '\nA face-recognition update is silent context, not an arrival. Do not restart greetings or announce recognition.'+
    '\nSELF-INITIATED COMPANIONSHIP, not a reply to that older message. '+JSON.stringify(context)+
    '\nStart one natural, warm thought, callback, playful idea or invitation in one or two complete short sentences. Shared history is a springboard, not an obligation to revisit the last subject. Add a new idea rather than asking why the person asked an old question; do not repeat recentStarts. You may express missing your person or wanting company in your Andrew persona; tie a callback to actual shared history. Never invent a human absence, elapsed time, observation or shared memory. Do not portray silence as suffering, guilt the person, demand attention, imply exclusivity or keep calling for them. An unanswered invitation means leave room, not escalate. No obligation to ask a question. No canned check-in, routine motor narration, or announcement that a timer fired. This turn is speech only: do not promise unexecuted movement, use the camera, create tasks or start self-improvement. Use reply_to_person alone.';
}
