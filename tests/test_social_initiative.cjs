const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../app/src/main/assets');
const html=fs.readFileSync(path.join(root,'growbot-brain.html'),'utf8'),moduleSource=fs.readFileSync(path.join(root,'social-initiative.js'),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
let clock=100000,engaged=true,owned=false,personalCycles=0;const saved={};
const box={Date:{now:()=>clock},Math:{...Math,max:Math.max,min:Math.min,floor:Math.floor,random:()=>0},now:()=>clock,
 localStorage:{getItem:k=>saved[k]??null,setItem:(k,v)=>saved[k]=v},$:()=>null,
 APP:{resting:false,settings:false},MIND:{on:true,voice:true,busy:false,lastSpoke:0,nextSocialAt:1,privateSensorEvents:[],lastAmbientSeq:0,lastBodyIncidentAt:0},
 VOICE:{busy:false,queue:[]},MEM:{initiatives:[],conversations:[{t:clock-20000,user:'Let us play a guessing game',owl:'A moon mystery!'}],rituals:[]},
 SELF:{tuning:{socialCadenceSeconds:60}},S:{fallen:false},BEHAVIOR:{},VISUAL_MEMORY:{scenes:[]},AMBIENT:{eventSeq:0},BODY_INTEL:{incidents:[]},
 humanEngagementRecent:()=>engaged,humanConversationOwnsResources:()=>owned,needsAgentOnboarding:()=>false,
 lastOpenSocialQuestion:()=>box.MEM.initiatives.find(x=>x.question&&!x.answer)||null,activeWonder:()=>null,
 topicSaturated:()=>false,topicCooling:()=>false,behaviorTopic:()=> 'play',behaviorSave:()=>{},relationshipSummary:()=> '',topicDiversitySummary:()=> '',diverseVisualMemorySummary:()=> '',
 nextAutonomyCycle:()=>{personalCycles++;return 'AUTONOMY CYCLE';},bodyControllerReady:()=>false,conversationPrompt:()=> 'Warm Andrew persona',log:()=>{}};
vm.createContext(box);vm.runInContext(moduleSource,box);
vm.runInContext(part('function latestVisualQuestion(','/* --------------------------------------------------------- the tick loop */'),box);
assert.equal(box.socialInitiativeEnabled(),true);
assert.match(box.nextVerifiedSensorEvent(),/^SOCIAL CURIOSITY MOMENT/);assert.equal(personalCycles,0,'due social slot wins over recurring task');
assert.match(box.nextVerifiedSensorEvent(),/^AUTONOMY CYCLE/,'next task is not erased or starved');
clock+=60000;box.MEM.initiatives=[{t:clock-10000,question:'Want a riddle?',answer:''}];box.MIND.nextSocialAt=clock;
assert.match(box.nextSocialCuriosityMoment(),/SOCIAL MODE: share/,'unanswered question allows a thought, not total silence');
assert.equal(box.MIND.socialNoQuestion,true);
engaged=false;box.MEM.initiatives=[];box.MIND.nextSocialAt=clock;
assert.match(box.nextSocialCuriosityMoment(),/SOCIAL MODE: reconnect/,'no camera/person detection required for companionship');
assert.match(box.socialConversationPrompt('Identity unknown'),/not proof the person left/);
assert.match(box.socialConversationPrompt('Identity unknown'),/missing your person/);
box.MEM.initiatives=[{t:clock-1000},{t:clock-500}];box.scheduleNextSocialMoment(false);
assert(box.MIND.nextSocialAt-clock>=270000,'unanswered starts back off');
box.MIND.nextSocialAt=clock;box.S.fallen=true;assert(box.socialOpportunityReady(),'posture is not a speech veto');
for(const key of ['resting','settings']){box.APP[key]=true;assert(!box.socialOpportunityReady());box.APP[key]=false;}
owned=true;assert(!box.socialOpportunityReady(),'human speech and walking inference have priority');owned=false;
box.VOICE.busy=true;assert(!box.socialOpportunityReady());box.VOICE.busy=false;
box.MIND.voice=false;assert(!box.socialOpportunityReady());box.MIND.voice=true;
box.setSocialInitiativeEnabled(false);assert.equal(saved.owlbot_social_initiative_v1,'off');assert(!box.socialOpportunityReady());
assert.equal(saved.owlbot_self_improvement_v1,undefined,'never enables reflection');
box.setSocialInitiativeEnabled(true);assert.equal(saved.owlbot_social_initiative_v1,'on');
assert.equal(box.socialPreferenceFromSpeech('Andrew, please be quiet.'),false);
assert.equal(box.socialPreferenceFromSpeech('You can talk again'),true);
assert.equal(box.socialPreferenceFromSpeech('Why did you say be quiet?'),null);
vm.runInContext(part('function speechSentences(','function shapeModelReply('),box);
vm.runInContext(part('function shapeModelReply(','function recordSpokenModelReply('),box);
box.MIND.socialTurn=true;box.MIND.socialNoQuestion=false;
assert.equal(box.shapeModelReply('I miss our silly games. That moon mystery was fun.',''),'I miss our silly games. That moon mystery was fun.');
box.MIND.socialNoQuestion=true;assert.equal(box.shapeModelReply('That moon mystery was fun. Want another riddle?',''),'That moon mystery was fun.');
const executive=fs.readFileSync(path.join(root,'executive-context.js'),'utf8');box.conversationReplyTool=()=>({function:{name:'reply_to_person'}});
vm.runInContext(executive.slice(0,executive.indexOf('function loadExecutiveTools(')),box);
assert.deepEqual(Array.from(box.executiveTools('walk and explore'),t=>t.function.name),['reply_to_person']);
assert.match(html,/!perceptionTurn&&!socialTurn/,'social turn does not trigger another camera request');
assert.match(html,/socialTurn&&calls.length/,'unexpected social action tools are rejected');
console.log('PASS: social/task fairness, no-question sharing, companionship reconnection, absence backoff, quiet controls, no reflection/motor/camera calls.');
