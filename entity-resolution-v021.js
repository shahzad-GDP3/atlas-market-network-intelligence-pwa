(()=>{
'use strict';
try{
  const FRONTEND_MODE='DB-MANAGED-1.0';
  const APP_VERSION='0.22.0-PWA';
  const basePostPayload=postPayload;

  /*
   * Supplier identity is intentionally NOT resolved or blocked in the frontend.
   * Field users enter the observed supplier data and continue normally.
   * The backend/database owns entity resolution, verification and segregation.
   */
  postPayload=function(payload){
    if(payload&&payload.action==='submitSurvey'){
      payload.appVersion=APP_VERSION;
      payload.entityResolutionVersion=FRONTEND_MODE;

      const stateBrands=Array.from(state.brands.values());
      (payload.brands||[]).forEach((brand,bi)=>{
        const stateBrand=stateBrands[bi];
        (brand.sources||[]).forEach((source,si)=>{
          const observed=stateBrand&&stateBrand.sources&&stateBrand.sources[si];
          if(!observed)return;

          const enteredName=String(observed.sourceName||'').trim();
          const enteredCity=String(observed.sourceCity||'').trim();
          const enteredMobile=String(observed.sourceMobile||'').trim();

          // Preserve exactly what the field user entered for audit/review.
          source.sourceNameRaw=enteredName;
          source.sourceCityRaw=enteredCity;
          source.sourceMobileRaw=enteredMobile;

          // Keep the normal operational fields too; backend will classify them.
          source.sourceName=enteredName;
          source.sourceCity=enteredCity;
          source.sourceMobile=normalizeMobile(enteredMobile);
          source.sourceTelecode=String(observed.sourceTelecode||source.sourceTelecode||'').trim();
          source.sourceId=String(observed.sourceId||source.sourceId||'').trim();

          // Do not send a frontend identity decision. Database workflow is authoritative.
          delete source.sourceEntityId;
          delete source.canonicalEntityId;
          delete source.resolutionStatus;
          delete source.resolutionRule;
          delete source.identityKey;
        });
      });
    }
    return basePostPayload(payload);
  };

  // Version label only. No supplier resolver, search, blur check or Continue gate is installed.
  document.querySelectorAll('.userMeta').forEach(el=>{
    if(el.textContent.includes('v0.18.0-PWA'))el.innerHTML=el.innerHTML.replace('v0.18.0-PWA',APP_VERSION);
    else if(el.textContent.includes('v0.21.1-PWA'))el.innerHTML=el.innerHTML.replace('v0.21.1-PWA',APP_VERSION);
  });

  console.info('[Atlas MNI] frontend supplier validation disabled;',FRONTEND_MODE,'loaded');
}catch(err){
  console.error('[Atlas MNI] DB-managed supplier mode failed; base app remains available.',err);
}
})();
