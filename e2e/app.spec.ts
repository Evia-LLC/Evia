/** Browser contract tests with explicitly mocked API boundaries. Not a live email/provider test. */
import { test, expect, type Page } from '@playwright/test';
import { REVIEW_VERSIONS } from '../shared/legal-review.ts';
const user={id:'a745c4f0-d712-49a0-990a-bea0483feb36',email:'fixture@example.test',displayName:'Sample',dateOfBirth:'2000-01-01',createdAt:'2026-01-01T00:00:00.000Z',scanCount:0,consents:{},profile:{skinType:'unknown',fitzpatrick:null,concerns:[],sensitivities:[],pregnancyStatus:'unknown',updatedAt:'2026-01-01'},preferences:{explanationStyle:'adaptive',voiceEnabled:false,voiceURI:null,reducedMotion:true,qualityTier:'low',locale:'en'}};
async function setup(page:Page,signedIn=false) {
 const calls:string[]=[];const missing:string[]=[];const failures:string[]=[];
 page.on('pageerror',error=>failures.push(error.message));
 await page.addInitScript(({wordingVersionId})=>{
  const now=Date.now();localStorage.setItem('evia.cookie-preferences',JSON.stringify({wordingVersionId,recordedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),preferences:{necessary:true,functional:true,analytics:false,marketing:false}}));localStorage.setItem('elohim.intro.seen','1');localStorage.setItem('elohim.sound','0');
 },{wordingVersionId:REVIEW_VERSIONS['cookie-preferences']});
 await page.route('**/api/**',async route=>{
  const req=route.request();const path=new URL(req.url()).pathname;const key=req.method()+' '+path;calls.push(key);
  let status=200;let body:unknown;
  switch(key) {
   case 'GET /api/health':body={ok:true,database:true,modelAvailable:false,model:null,imageStorage:false,clonedVoice:false,guestVoice:false,demoMode:false,registrationEnabled:true,emailConfirmationRequired:true};break;
   case 'GET /api/me':status=signedIn?200:401;body=signedIn?{user,modelAvailable:false}:{error:'Not signed in.'};break;
   case 'POST /api/auth/register':body={confirmationRequired:true,user:null};status=202;break;
   case 'POST /api/auth/login':signedIn=true;body={user};break;
   case 'POST /api/auth/logout':signedIn=false;body={ok:true};break;
   case 'POST /api/auth/resend-confirmation':
   case 'POST /api/auth/password-reset':body={ok:true,message:'If that account exists, an email has been requested.'};status=202;break;
   case 'GET /api/chat/history':body={messages:[{id:'fixture-message',role:'elohim',content:'Hello from the isolated test fixture.',createdAt:new Date().toISOString()}]};break;
   case 'GET /api/scans':case 'GET /api/body-scans':body={scans:[]};break;
   case 'GET /api/scans/summary':body={summary:null};break;
   case 'GET /api/progress-photos':body={photos:[]};break;
   case 'GET /api/memories':body={memories:[]};break;
   case 'GET /api/routine':body={usage:[],review:null};break;
   case 'GET /api/routine/outcomes':body={outcomes:[]};break;
   case 'GET /api/me/consents/history':body={decisions:[]};break;
   case 'GET /api/me/consents':body={consents:{}};break;
   case 'GET /api/public/analysis':body={provider:'local',available:false,sampleDemo:false};break;
   case 'POST /api/analysis/legal-review':body={ok:true};break;
   case 'GET /api/voice/capabilities':body={clonedVoice:false,guestVoice:false};break;
   default:
    if(path.includes('/picks'))body={picks:[]};
    else {status=404;body={error:'Unmocked test endpoint'};missing.push(key);}
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 return {calls,missing,failures};
}
test('signup stays signed out pending email confirmation and offers resend/recovery',async({page})=>{
 const state=await setup(page);
 await page.goto('/');
 await page.getByRole('button',{name:'Create account',exact:true}).click();
 await page.getByLabel('Date of birth', {exact:true}).fill('2000-01-01');
 await page.locator('input[type="email"]').fill('fixture@example.test');
 await page.locator('input[type="password"]').fill('a test password');
 await page.locator('input[type="checkbox"][required]').check();
 await page.locator('button[type="submit"]').click();
 await expect(page.getByRole('status').filter({hasText:'Check your email'})).toBeVisible();
 expect(state.calls).toContain('POST /api/auth/register');
 expect(state.calls).not.toContain('GET /api/chat/history');
 await expect(page.getByRole('button',{name:'Forgot password?',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Resend confirmation',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'email has been requested'})).toBeVisible();
 expect(state.failures).toEqual([]);
});
test('every core and policy URL renders without crashing with a real route instead of a silent home fallback',async({page})=>{
 test.setTimeout(180000);
 const state=await setup(page,true);
 const routes=['/','/scan','/progress','/routine','/profile','/privacy','/settings/data','/legal/age-assurance','/legal/terms','/legal/privacy','/legal/facial-scan-consent','/legal/health-consent','/legal/safety-lifestyle-consent','/legal/progress-photo-consent','/legal/subscription','/legal/cancellation','/auth/recovery'];
 for(const path of routes) {
  console.log('Route',path);await page.goto(path);await expect(page.locator('h1,h2').first()).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('That page is not here.');
 }
 await page.goto('/this-is-not-a-page');await expect(page.getByRole('heading',{name:'That page is not here.'})).toBeVisible();
 expect(state.failures).toEqual([]);
 expect(state.missing).toEqual([]);
});
test('guest routine does not make account requests and cannot silently save data',async({page})=>{
 const state=await setup(page);await page.goto('/');await page.getByRole('button',{name:/Look around without an account/}).click();
 await page.locator('a[href="/routine"]').first().click();
 await expect(page.getByRole('status').filter({hasText:/Sign in|private preview/i}).first()).toBeVisible();
 expect(state.calls).not.toContain('GET /api/routine');
 await expect(page.getByRole('button',{name:'Add',exact:true})).toBeDisabled();
 expect(state.failures).toEqual([]);
});
test('account deletion still requires typed and final confirmation and unknown errors never claim data is intact',async({page})=>{
 await setup(page,true);
 await page.route('**/api/public/legal-review',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
 await page.route('**/api/me/data',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"Deletion outcome unknown","rollbackConfirmed":false}'}));
 await page.goto('/settings/data');
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
 await page.getByLabel('Type DELETE to confirm account deletion').fill('DELETE');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByText('Final confirmation',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Permanently delete my account',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'result could not be verified'})).toBeVisible();
 await expect(page.getByText('Your account and data are intact',{exact:false})).toHaveCount(0);
});
