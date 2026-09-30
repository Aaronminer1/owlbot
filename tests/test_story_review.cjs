const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname+'/../app/src/main/assets/';
const OwlStory=require(root+'story-core.js');let count=0,responseText='',sent;
const b={OwlStory,Map,Set,JSON,Error,EXPRESSIONS:{neutral:{},curious:{},content:{},humming:{}},
 $:s=>({value:s==='#mModel'?'test-model':'http://localhost/v1'}),mindHeaders:()=>({}),
 mindFetch:async(url,opts)=>{count++;sent=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:responseText}}]})};}};
vm.createContext(b);vm.runInContext(fs.readFileSync(root+'story-scenes.js','utf8'),b);
const story={id:'stored',text:'A friend arrived. We enjoyed a quiet day.',title:'A visit',edition:'Unchanged text'};
const parts=OwlStory.plan(story.text),review={safeForChild:true,coherent:true,complete:true,cues:parts.map((p,index)=>({index,emotion:index?'content':'curious',reason:'The scene changes from arrival to shared calm.'}))};
(async()=>{
 assert.throws(()=>b.validateStoryReview({...review,safeForChild:false,issue:'Unsafe handling advice'},story,parts),/needs revision/);
 assert.throws(()=>b.validateStoryReview({...review,complete:false},story,parts),/needs revision/);
 assert.throws(()=>b.validateStoryReview({...review,cues:[]},story,parts),/every passage/);
 const rangePlan=b.validateStoryReview({...review,cues:[{start:0,end:parts.length-1,emotion:'content',reason:'A shared calm visit.'}]},story,parts);
 assert.equal(rangePlan.length,parts.length);assert(rangePlan.every(p=>p.emotion==='content'));
 assert.throws(()=>b.validateStoryReview({...review,cues:[{start:1,end:parts.length-1,emotion:'content',reason:'Missing opening.'}]},story,parts),/Invalid/);
 assert.throws(()=>b.validateStoryReview({...review,cues:review.cues.map(x=>({...x,emotion:'humming'}))},story,parts),/Invalid/);
 responseText=JSON.stringify(review);let plan=await b.prepareStoryPerformance(story,parts,{aborted:false});
 assert.equal(plan.map(p=>p.text).join(' '),story.text);assert.deepEqual(Array.from(plan,p=>p.start),parts.map(p=>p.start));
 assert(plan.every(p=>p.emotion&&p.reason));assert(!plan.some(p=>p.text.includes('scene changes')));
 await b.prepareStoryPerformance(story,parts,{aborted:false});assert.equal(count,1,'Repeat uses bounded session cache');
 assert(sent.messages[0].content.includes('suspected explosives'));assert(sent.messages[0].content.includes('historical edition'));
 responseText='not json';await assert.rejects(b.prepareStoryPerformance({...story,id:'invalid'},parts,{aborted:false}),/incomplete/);
 responseText=JSON.stringify(review);await assert.rejects(b.prepareStoryPerformance({...story,id:'cancel'},parts,{aborted:true}),/cancelled/);
 assert.throws(()=>b.validateNarrative({title:'Unfinished',scenes:[{text:'A friend arrived.',emotion:'curious',reason:'Arrival.'},{text:'And then they were about to',emotion:'curious',reason:'Unresolved.'}]}),/final sentence/);
 console.log('PASS story review: rejected unsafe/incomplete verdicts, complete cues, exact text/offsets, cache, malformed response and cancellation. Semantic judgement remains model-dependent.');
})().catch(e=>{console.error(e);process.exitCode=1});
