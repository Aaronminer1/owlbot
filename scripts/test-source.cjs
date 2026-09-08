const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.join(__dirname,'..'),files=fs.readdirSync(path.join(root,'tests')).filter(n=>/^test_.*\.cjs$/.test(n)).sort();
let failed=0;for(const file of files){const r=cp.spawnSync(process.execPath,[path.join(root,'tests',file)],{stdio:'inherit'});if(r.status!==0)failed++;}
console.log(`${files.length} suites; ${failed} failed.`);if(failed)process.exitCode=1;
