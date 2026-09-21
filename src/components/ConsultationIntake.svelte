<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { stillness } from '@/lib/motion.ts';
  import { emptyIntakeDraft, validateIntakeDraft, type IntakeDraft, type IntakePresentation, type IntakeAnswers } from '@shared/intake.ts';
  import { INTAKE_WELCOME_LINE, INTAKE_COMPLETE_LINE, visibleIntakeQuestions } from '@/lib/intake-content.ts';

  interface Props {
    onDone: (draft: IntakeDraft) => void;
    onBack: () => void;
    onPresent?: (presentation: IntakePresentation) => void;
  }
  let { onDone, onBack, onPresent }: Props = $props();
  // Deliberately not localStorage, sessionStorage, an API, or a model prompt.
  let draft = $state<IntakeDraft>(emptyIntakeDraft());
  let stage = $state<'welcome' | 'questions' | 'review'>('welcome');
  let index = $state(0);
  let error = $state('');
  let submitted = $state(false);
  let heading = $state<HTMLHeadingElement>();
  let container = $state<HTMLElement>();
  const questions = $derived(visibleIntakeQuestions(draft.answers));
  const question = $derived(questions[Math.min(index, questions.length - 1)]);
  const progress = $derived(stage === 'welcome' ? 0 : stage === 'review' ? 100 : Math.round(index / questions.length * 100));

  $effect(() => {
    const phase = stage;
    const current = question;
    // Public copy only: changing an answer never sends that answer to narration.
    const presentation: IntakePresentation = phase === 'welcome'
      ? { phase: 'welcome', line: INTAKE_WELCOME_LINE, directive: { state: 'HAPPY', expression: 'warm', gesture: 'small_wave', intensity: 0.55 } }
      : phase === 'review'
        ? { phase: 'complete', line: INTAKE_COMPLETE_LINE, directive: { state: 'EXPLAINING', expression: 'reassuring', gesture: 'open_palms', intensity: 0.48 } }
        : { phase: 'question', line: current.prompt, directive: current.directive };
    untrack(() => onPresent?.(presentation));
    void tick().then(() => { if (container) container.scrollTop = 0; heading?.focus({ preventScroll: true }); });
  });

  function setAnswer(value: string): void {
    const key = question.key;
    if (key === 'goals') return;
    draft.answers = { ...draft.answers, [key]: value || null };
    if (key === 'pregnancyChoice' && value !== 'include') draft.answers.pregnancyStatus = null;
    error = '';
  }
  function toggleGoal(goal: string): void {
    const value = goal as IntakeAnswers['goals'][number];
    const selected = draft.answers.goals;
    if (selected.includes(value)) draft.answers.goals = selected.filter((item) => item !== value);
    else if (value === 'unsure') draft.answers.goals = ['unsure'];
    else {
      const chosen = selected.filter((item) => item !== 'unsure');
      if (chosen.length >= 3) { error = 'Choose up to three, or remove one to make space.'; return; }
      draft.answers.goals = [...chosen, value];
    }
    error = '';
  }
  function next(): void {
    error = '';
    try { draft = validateIntakeDraft(draft); }
    catch (issue) { error = issue instanceof Error ? issue.message : 'Please check this answer.'; return; }
    if (index + 1 < questions.length) index++;
    else stage = 'review';
  }
  function skip(): void {
    draft.answers = { ...draft.answers, [question.key]: question.key === 'goals' ? [] : null };
    if (question.key === 'goals') draft.answers.goalNote = null;
    if (question.key === 'pregnancyChoice') draft.answers.pregnancyStatus = null;
    next();
  }
  function previous(): void {
    error = '';
    if (stage === 'review') { stage = 'questions'; index = questions.length - 1; }
    else if (index > 0) index--;
    else stage = 'welcome';
  }
  function complete(save: boolean): void {
    if (submitted) return;
    draft.storageConsent = save;
    try {
      const normalized = validateIntakeDraft(draft);
      submitted = true;
      onDone(normalized);
    } catch (issue) { error = issue instanceof Error ? issue.message : 'Please check the answers.'; }
  }
</script>

<section bind:this={container} class="intake" aria-label="Your consultation with Ese">
  <div class="intake__space" aria-hidden="true"></div>
  <div class="intake__stand">
    <div class="intake__plaque">
      <div class="intake__top"><span class="intake__brand">Ese</span><button class="intake__quiet" type="button" onclick={onBack} aria-label="Return to the welcome without saving">← Back to welcome</button></div>
      <div class="intake__progress" role="progressbar" aria-label="Consultation progress" aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100"><span style:width={`${progress}%`}></span></div>
      {#key stage === 'questions' ? question.key : stage}
        <div class="intake__content" in:fade={{ duration: stillness() ? 0 : 180 }}>
          {#if stage === 'welcome'}
            <p class="intake__eyebrow">Come as you are</p>
            <h1 bind:this={heading} tabindex="-1">Let’s get to know<br />your skin. And you.</h1>
            <p class="intake__welcome">{INTAKE_WELCOME_LINE}</p>
            <p class="intake__note">Every question is optional. No camera, photos or diagnosis. Your answers stay in this page until you choose whether to save them with an account.</p>
            <div class="intake__actions"><button class="intake__primary" type="button" onclick={() => (stage = 'questions')}>Let’s begin <span aria-hidden="true">↗</span></button></div>
            <button class="intake__quiet" type="button" onclick={onBack}>Back to the welcome</button>
          {:else if stage === 'questions'}
            <div class="intake__question-meta"><p class="intake__eyebrow">{question.section}</p><span>{index + 1} / {questions.length}</span></div>
            <h1 bind:this={heading} tabindex="-1">{question.prompt}</h1>
            <p class="intake__help" id="intake-help">{question.help}</p>
            {#if question.sensitive}<p class="intake__private">Personal · optional · you can skip</p>{/if}
            <form onsubmit={(event) => { event.preventDefault(); next(); }}>
              {#if question.kind === 'text'}
                {#if question.key === 'preferredName'}
                  <input aria-label="Preferred name" aria-describedby="intake-help" autocomplete="off" maxlength={question.limit}
                    value={String(draft.answers[question.key] ?? '')} oninput={(event) => setAnswer(event.currentTarget.value)} placeholder={question.placeholder} />
                {:else}
                  <textarea aria-label={question.prompt} aria-describedby="intake-help" autocomplete="off" rows="4" maxlength={question.limit}
                    value={String(draft.answers[question.key] ?? '')} oninput={(event) => setAnswer(event.currentTarget.value)} placeholder={question.placeholder}></textarea>
                {/if}
              {:else}
                <div class="intake__choices" role="group" aria-label={question.prompt} aria-describedby="intake-help">
                  {#each question.options ?? [] as option (option.value)}
                    <button type="button" class="intake__choice" aria-pressed={question.kind === 'goals' ? draft.answers.goals.includes(option.value as IntakeAnswers['goals'][number]) : draft.answers[question.key] === option.value}
                      onclick={() => question.kind === 'goals' ? toggleGoal(option.value) : setAnswer(option.value)}>{option.label}<span aria-hidden="true">+</span></button>
                  {/each}
                </div>
                {#if question.kind === 'goals'}
                  <label class="intake__field-note" for="goal-note">Anything you would like to add? <span>Optional</span></label>
                  <textarea id="goal-note" rows="2" maxlength="400" autocomplete="off" value={draft.answers.goalNote ?? ''}
                    oninput={(event) => { draft.answers.goalNote = event.currentTarget.value || null; }} placeholder="In your own words…"></textarea>
                {/if}
              {/if}
              {#if error}<p class="intake__error" role="alert">{error}</p>{/if}
              <div class="intake__actions"><button class="intake__quiet" type="button" onclick={previous}>Back</button><button class="intake__primary" type="submit">Continue <span aria-hidden="true">↗</span></button></div>
              <button class="intake__skip" type="button" onclick={skip}>{question.sensitive ? 'Prefer not to answer' : 'Skip this question'}</button>
            </form>
          {:else}
            <p class="intake__eyebrow">Your choice, always</p>
            <h1 bind:this={heading} tabindex="-1">What would you<br />like me to remember?</h1>
            <p class="intake__welcome">Thank you for sharing what feels comfortable.</p>
            <p class="intake__note">“Save with my account” gives permission to store the answers you chose to provide, including any personal health details, after you create your account. Skipped answers stay unknown.</p>
            <p class="intake__note">Your preferred name, stated skin feel, selected goals and pregnancy answer also update your profile. Other intake notes stay separate from AI prompts. Photos and cloud processing have separate permission controls. You can export your intake or delete it with your account.</p>
            <p class="intake__boundary">This is a skincare conversation, not medical clearance for a product or procedure. A clinician can help with persistent symptoms, allergies or treatment decisions.</p>
            {#if error}<p class="intake__error" role="alert">{error}</p>{/if}
            <div class="intake__finish"><button class="intake__primary" type="button" disabled={submitted} onclick={() => complete(true)}>Save with my account <span aria-hidden="true">↗</span></button>
              <button class="intake__secondary" type="button" disabled={submitted} onclick={() => complete(false)}>Continue without saving answers</button></div>
            <button class="intake__quiet" type="button" onclick={previous}>Review my answers</button>
          {/if}
        </div>
      {/key}
      <span class="intake__brass" aria-hidden="true">E S E · C O N S U L T A T I O N</span>
    </div>
    <div class="intake__pillar" aria-hidden="true"></div>
  </div>
</section>

<style>
  .intake{position:fixed;inset:0;z-index:45;display:grid;grid-template-columns:minmax(180px,1fr) minmax(320px,560px);gap:clamp(18px,4vw,76px);align-items:center;padding:38px max(5vw,24px) 18px;background:linear-gradient(90deg,transparent 20%,rgba(26,19,14,.1) 55%,rgba(26,19,14,.32));overflow:auto;pointer-events:none;color:#fbf2df;font-family:var(--font-body,Arial,sans-serif)}
  .intake__stand{align-self:center;position:relative;perspective:1400px;pointer-events:auto;max-width:560px;width:100%;margin-left:auto;padding-bottom:38px}
  .intake__plaque{position:relative;border-radius:5px 5px 9px 9px;padding:25px clamp(22px,3vw,40px) 40px;border:1px solid #ad7952;background:repeating-linear-gradient(2deg,transparent 0 6px,rgba(211,155,95,.035) 7px,transparent 9px 20px),linear-gradient(98deg,#3a2218,#66412c 16%,#513220 62%,#3b241a);box-shadow:inset 0 1px 0 #cba47688,inset 0 0 0 5px #34211666,0 28px 80px #110b0777,8px 6px 0 #2d1c15;transform:rotateY(-3deg)}
  .intake__pillar{position:absolute;top:96%;bottom:0;height:140px;left:40%;width:20%;z-index:-1;background:linear-gradient(90deg,#2c1d16,#5b3d2a 42%,#3f281e 75%,#251811);border-radius:0 0 5px 5px;box-shadow:14px 10px 24px #160e0655}
  .intake__top{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#d8be98;font-size:10px;text-transform:uppercase;letter-spacing:.17em;margin-bottom:16px}.intake__brand{font-family:Georgia,serif;font-size:25px;letter-spacing:.01em;text-transform:none;color:#f5e5c6}.intake__progress{height:2px;background:#d9bf8c25;margin-bottom:25px}.intake__progress span{display:block;height:100%;background:#dfbd7b;transition:width .25s ease}.intake__content{min-height:330px}.intake__eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#dec397;margin:0 0 14px}.intake__question-meta{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.intake__question-meta>span{font-size:11px;white-space:nowrap;color:#d0b798}
  h1{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:clamp(27px,2.7vw,41px);line-height:1.13;letter-spacing:-.025em;margin:0 0 19px;color:#fff7e8;outline:none;text-wrap:balance}.intake__welcome{font-family:Georgia,serif;font-size:18px;line-height:1.55;color:#f1dec0;margin:0 0 18px}.intake__help,.intake__note{font-size:12px;line-height:1.6;color:#deccb3;margin:0 0 17px}.intake__boundary{font-size:11px;line-height:1.5;color:#d5ba93;padding-top:12px;border-top:1px solid #d3ac7833}.intake__private{font-size:10px;color:#efd2a8;margin:-6px 0 13px;letter-spacing:.05em}
  input,textarea{display:block;width:100%;box-sizing:border-box;padding:14px;border-radius:3px;background:#2417108a;border:1px solid #c79d6966;box-shadow:inset 0 1px 4px #160d0855;color:#fff4e4;font:inherit;font-size:14px;line-height:1.5;resize:vertical}input::placeholder,textarea::placeholder{color:#d1b99b9e}input:focus,textarea:focus{outline:2px solid #e1c38a;outline-offset:3px}.intake__choices{display:grid;grid-template-columns:1fr 1fr;gap:7px}.intake__choice{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:47px;text-align:left;border:1px solid #bf97605e;border-radius:3px;padding:11px 12px;background:#24181055;color:#eee0c7;font:inherit;font-size:12px;line-height:1.35;cursor:pointer}.intake__choice span{font-size:17px;color:#ba976d}.intake__choice[aria-pressed=true]{background:#eedcb7;border-color:#f7e7c8;color:#352216}.intake__choice[aria-pressed=true] span{transform:rotate(45deg);color:#6a472f}.intake__field-note{display:flex;justify-content:space-between;font-size:11px;color:#e3cfac;margin:17px 0 8px}.intake__field-note span{color:#c9aa81}
  .intake__actions{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:24px}.intake__primary,.intake__secondary{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 18px;border:1px solid #edcea2;border-radius:3px;background:#efdfc1;color:#362216;font:inherit;font-size:12px;font-weight:600;cursor:pointer;min-height:46px}.intake__primary span{font-size:20px;line-height:1}.intake__quiet,.intake__skip{border:0;padding:9px 0;background:transparent;color:#e7ccaa;font:inherit;font-size:11px;cursor:pointer;text-decoration:underline;text-underline-offset:4px}.intake__skip{margin-top:10px;width:100%;text-align:center;color:#d0b18c}.intake__finish{display:grid;gap:10px;margin-top:22px}.intake__secondary{background:transparent;color:#ead3af;border-color:#c29a664d;justify-content:center;font-weight:400}.intake__error{font-size:12px;line-height:1.45;color:#ffddbd;margin:12px 0}button:focus-visible{outline:2px solid #ffe1a4;outline-offset:4px}button:disabled{opacity:.5;cursor:default}.intake__brass{display:block;margin-top:26px;padding-top:13px;border-top:1px solid #c59b6144;font-size:7px;letter-spacing:.25em;text-align:center;color:#cfa571}
  @media(max-width:759px){.intake{display:block;top:44%;padding:0 14px max(16px,env(safe-area-inset-bottom));background:none;overflow-y:auto;overscroll-behavior:contain;pointer-events:auto}.intake__space{display:none}.intake__stand{padding-bottom:30px;margin:0 auto}.intake__plaque{padding:20px 22px 27px;transform:none}h1{font-size:29px}.intake__welcome{font-size:16px}.intake__content{min-height:0}.intake__top{font-size:8px;letter-spacing:.08em}.intake__note,.intake__help{font-size:12px}.intake__pillar{height:50px}}
  @media(max-width:430px){.intake{padding-left:10px;padding-right:10px}.intake__plaque{padding:18px 18px 25px}h1{font-size:27px}.intake__primary{padding:12px;gap:14px}.intake__question-meta>span{font-size:10px}.intake__choices{grid-template-columns:1fr}}
  @media(prefers-reduced-motion:reduce){.intake__progress span{transition:none}.intake__plaque{transform:none}}
</style>
