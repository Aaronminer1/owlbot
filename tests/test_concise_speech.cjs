const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/growbot-brain.html'),'utf8');
const cut=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const b={MIND:{recentReplies:[]},SELF:{tuning:{repeatSimilarity:.8}},spokenReply:x=>x,unsupportedSpokenClaim:()=>false,replySimilarity:()=>0,log:()=>{}};
vm.createContext(b);vm.runInContext(cut('function groundedSpokenReply(','function shapeModelReply('),b);
assert.equal(b.speechBudget('How far away am I?').sentences,2);
assert.equal(b.speechBudget('One short sentence please').sentences,1);
assert.equal(b.speechNeedsConciseRewrite('First. Second. Third.','How far away am I?'),true);
assert.equal(b.speechNeedsConciseRewrite('word '.repeat(60)+'.','What did you find?'),true);
assert.equal(b.speechNeedsConciseRewrite('About fourteen inches away.','How far away am I?'),false);
assert.equal(b.speechNeedsConciseRewrite('I can see someone, but cannot tell who it is.','Who is there?'),false);
for(const q of ['Tell me a complete story','Write a poem','Explain in detail','Give a step-by-step explanation']){
 assert.equal(b.speechNeedsConciseRewrite('First. Second. Third. Fourth. Fifth.',q),false,q);
}
assert.equal(b.groundedSpokenReply('About 0.81 meters, or 2.7 feet.','How far away am I?'),'About 0.81 meters, or 2.7 feet.');
assert.match(b.spokenAnswerContract('Hello'),/not your analysis/);
assert.match(b.spokenAnswerContract('Hello'),/Never hide a material limitation/);
assert.match(html,/!conciseRewriteUsed&&loops<maxToolLoops/,'rewrite is bounded');
assert.match(html,/rewritingSpeech\?\[conversationReplyTool\(\)\]/,'rewrite exposes only speech');
assert.match(html,/if\(rewritingSpeech&&calls.length\)/,'ignored rewrite schema cannot replay an action');
console.log('PASS concise defaults, bounded speech-only rewrite, detail/story exceptions, meaningful uncertainty and decimal preservation.');
