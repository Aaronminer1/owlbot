// Synthetic markers are constructed only in a disposable local Git repository.
// No network, real credentials, phone data or changes to this repo's index.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const scanner=path.resolve(__dirname,'../scripts/check-secrets.ps1');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'owlbot-secret-test-'));
const git=(...args)=>{const p=cp.spawnSync('git',args,{cwd:fixture,encoding:'utf8'});assert.equal(p.status,0,p.stderr);};
const scan=()=>cp.spawnSync('pwsh',['-NoProfile','-File',scanner,'-RepoPath',fixture],{encoding:'utf8'});
const marker=['sk','A'.repeat(32)].join('-');
try{
 git('init','--quiet');fs.writeFileSync(path.join(fixture,'sample.txt'),'safe example');git('add','sample.txt');
 let r=scan();assert.equal(r.status,0,r.stderr);
 fs.writeFileSync(path.join(fixture,'sample.txt'),marker);r=scan();assert.notEqual(r.status,0);assert.match(r.stdout,/working tree/);assert(!r.stdout.includes(marker)&&!r.stderr.includes(marker),'never print a matched value');
 git('add','sample.txt');fs.writeFileSync(path.join(fixture,'sample.txt'),'safe on disk, unsafe in index');
 r=scan();assert.notEqual(r.status,0);assert.match(r.stdout,/Git index/);assert(!r.stdout.includes(marker)&&!r.stderr.includes(marker));
 git('add','sample.txt');fs.mkdirSync(path.join(fixture,'backups'));fs.writeFileSync(path.join(fixture,'backups','state.json'),'{}');git('add','backups/state.json');
 r=scan();assert.notEqual(r.status,0);assert.match(r.stdout,/Forbidden tracked path/);
 git('rm','--cached','backups/state.json');
 fs.mkdirSync(path.join(fixture,'firmware/pico'),{recursive:true});
 for(const name of ['servo_channels.json','named_walk.json','dog_cal.json','dog_gait.json','gaze_cal.json','stock_commands.json','control_token.txt']){
  const file='firmware/pico/'+name;fs.writeFileSync(path.join(fixture,file),'{}');git('add',file);
  r=scan();assert.notEqual(r.status,0);assert.match(r.stdout,/Forbidden tracked path/);
  git('rm','--cached',file);
 }
 console.log('PASS: clean tree accepted; working/staged secrets, private artifacts and Pico configuration blocked without printing values.');
}finally{
 // Delete only the exact generated fixture, never an unresolved broad root.
 const resolved=fs.realpathSync(fixture),parent=fs.realpathSync(os.tmpdir());
 assert.equal(path.dirname(resolved),parent);assert(path.basename(resolved).startsWith('owlbot-secret-test-'));
 fs.rmSync(resolved,{recursive:true,force:true});
}
