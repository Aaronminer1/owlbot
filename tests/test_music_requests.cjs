const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=__dirname+'/../app/src/main/assets/';
const html=fs.readFileSync(root+'growbot-brain.html','utf8');
const score=require(root+'music-core.js').parseMidi(fs.readFileSync(root+'music/fur-elise.mid'));
const clock=2000000;
const box={console,window:{},Date:{now:()=>clock},setTimeout(){},clearTimeout(){},
 localStorage:{getItem:()=>null,setItem(){}},document:{getElementById(){},addEventListener(){}},
 MEM:{conversations:[{t:clock-3000,user:'eenie meenie miney',owl:'Tiger rhyme'},
 {t:clock-1000,user:"what's your favorite song",owl:'Für Elise — Beethoven.'}]},
 BACKGROUND:{jobs:[],running:new Map()},APP:{resting:false,settings:false},MIND:{on:true,userQueue:[]},
 VOICE:{queue:[]},EARS:{},walkingStreamStatus:()=>({active:false}),backgroundSave(){},pumpBackgroundJobs(){},
 improvementWorkAllowed:()=>true,replySimilarity:(a,b)=>a===b?1:0,recentBackgroundDuplicate:()=>false,
 backgroundNeedsVision:()=>true,OwlMusic:require(root+'music-core.js')};
vm.createContext(box);
vm.runInContext(fs.readFileSync(root+'music-player.js','utf8'),box);
const cut=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
vm.runInContext(cut('function activeBackgroundJobs(', 'function backgroundNeedsVision('),box);
vm.runInContext(cut('function delegateBackgroundTask(', 'function backgroundToolNames('),box);
const run=s=>vm.runInContext(s,box);
(async()=>{
 run(`musicPrepareOwnerRequest('can you make up a new song using that')`);
 const job=box.BACKGROUND.jobs[0];assert.equal(job.musicRequest.reference,'fur_elise');
 assert.equal(job.musicRequest.variation,true);assert.equal(job.needsVision,false);
 assert.equal(job.musicRequest.instrument,'piano');
 run(`musicPrepareOwnerRequest('hum')`);assert.equal(job.musicRequest.instrument,'hum');
 run(`musicPrepareOwnerRequest('piano')`);assert.equal(job.musicRequest.instrument,'piano');
 assert.equal(box.BACKGROUND.jobs.length,1);
 for(const claim of ["It's already playing in the background",'I made the new song.','Let me try the piano for real now.',"I'll play the new tune now."])
   assert.match(box.musicGroundReply(claim,'piano'),/hasn’t started/);
 assert.equal(box.musicGroundReply('A piano has strings.','what is a piano'),'A piano has strings.');
 assert.equal(box.musicGroundReply('I made a pretend cake.','let’s play pretend'),'I made a pretend cake.');
 run(`MIDI_PLAYER.playing=true;MIDI_PLAYER.jobId=null`);
 assert.match(box.musicGroundReply("It's already playing",'piano'),/hasn’t started/,'Idle song is not proof of composition');
 run(`MIDI_PLAYER.jobId=${JSON.stringify(job.id)}`);
 assert.equal(box.musicGroundReply("It's already playing",'piano'),"It's already playing");
 run(`MIDI_PLAYER.playing=false`);job.status='blocked';job.error='mind provider timed out after 45 seconds';
 assert.match(box.musicGroundReply("I'll play the song now",'piano'),/timed out/);
 assert.match(box.musicContext(),/blocked/);
 assert.equal(run(`musicHandleIntent('play a new song using part of Fur Elise')`),false);
 assert.equal(run(`musicHandleIntent('hum a variation on Fur Elise')`),false);
 box.loadedScore=score;run('MUSIC.cache=loadedScore');
 const prompt=await box.musicWorkerPrompt(job);
 assert.match(prompt,/VERIFIED SOURCE MOTIF/);assert.match(prompt,/76,75,76,75,76,71,74,72,69/);
 assert.match(prompt,/instrument:piano/);assert.match(prompt,/omit song/);
 assert.throws(()=>box.musicValidateWorkerScore(job,{song:'fur_elise'}),/new composition/);
 const valid=box.musicValidateWorkerScore(job,{instrument:'hum',tempo:100,events:[{notes:[76],startBeat:0,durationBeats:.5}]});
 assert.equal(valid.instrument,'piano');assert.equal(valid._musicJobId,job.id);
 assert.throws(()=>box.musicValidateWorkerScore(job,{events:[]}),/note events/);
 assert.equal(box.musicOwnerJobCanStart(),true,'Owner music need not wait 45 seconds');
 box.VOICE.busy=true;assert.equal(box.musicOwnerJobCanStart(),false);box.VOICE.busy=false;
 box.EARS.on=true;assert.equal(box.musicOwnerJobCanStart(),false);box.EARS.on=false;
 box.APP.resting=true;assert.equal(box.musicOwnerJobCanStart(),false);box.APP.resting=false;
 const count=box.BACKGROUND.jobs.length;run(`musicPrepareOwnerRequest("don't make a new song")`);
  assert.equal(box.BACKGROUND.jobs.length,count);
  run(`musicPrepareOwnerRequest('play your saved piece Little Dragon Learns to Fly')`);
  assert.equal(box.BACKGROUND.jobs.length,count,'Saved replay must not start a replacement composition');
  run(`musicPrepareOwnerRequest('make a happy little piece')`);
  assert.equal(box.BACKGROUND.jobs.length,count+1,'Make a piece does not require the word up');
 box.MEM.conversations[1].t=0;
 assert.equal(box.musicRequestDetails('make a new song using that').reference,'','Stale conversation is not a reference');
 assert.match(html,/line=musicGroundReply\(line,userTurn\)/);
 assert.match(html,/musicGroundReply\(physicalActionSpeech/);
 console.log('Music requests: context, choice, true playback, false-claim guard, timeout, source motif, no camera, variation routing and priority passed');
})().catch(e=>{console.error(e);process.exitCode=1});
