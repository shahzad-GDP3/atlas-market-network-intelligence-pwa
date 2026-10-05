const fs=require('fs');
const js=fs.readFileSync('entity-resolution-v021.js','utf8');
const html=fs.readFileSync('field-app-v021.html','utf8');
const index=fs.readFileSync('index.html','utf8');
const must=(c,m)=>{if(!c)throw new Error(m)};

must(js.includes("const FRONTEND_MODE='DB-MANAGED-1.1'"),'DB-managed mode missing');
must(js.includes("const APP_VERSION='0.22.1-PWA'"),'app version missing');
must(js.includes('sourceNameRaw=enteredName'),'raw supplier name not preserved');
must(js.includes('sourceCityRaw=enteredCity'),'raw supplier city not preserved');
must(js.includes('sourceMobileRaw=enteredMobile'),'raw supplier mobile not preserved');
must(js.includes("action:'searchSources'"),'verified suggestions missing');
must(js.includes('Verified supplier suggestions'),'suggestion panel missing');
must(js.includes('Manual entry is available below'),'manual fallback missing');
must(js.includes('delete source.resolutionStatus'),'frontend resolution decision still being sent');
must(!js.includes("action:'resolveSource'"),'frontend resolveSource call still present');
must(!js.includes('Supplier mobile conflicts'),'frontend supplier conflict gate still present');
must(!js.includes('Checking suppliers...'),'frontend Continue supplier check still present');
must(!js.includes('verifyStepThreeSources'),'frontend identity verification step still present');
must(!js.includes('sourceResolutionReady'),'frontend submit identity gate still present');
must(html.includes('entity-resolution-v021.js?v=0221'),'new overlay cache key missing');
must(index.includes('field-app-v021.html?v=0221'),'index not routed to DB-managed build');

console.log('PASS PWA v0.22.1 DB-managed supplier flow with non-blocking verified suggestions');
