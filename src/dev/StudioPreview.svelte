<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { Stage } from '@/scene/stage.ts';
  import { LoungeEnvironment } from '@/scene/lounge.ts';
  import { ClinicalEnvironment } from '@/scene/clinical.ts';
  import { EseAvatar } from '@/character/ese-avatar.ts';
  import { HoloFaceMesh3D } from '@/holograms/face-mesh-3d.ts';
  import { HoloCard, TONE_NEUTRAL, TONE_BAD } from '@/holograms/cards.ts';
  import { studioFace } from './studio-fixture.ts';
  import type { CharacterDirective } from '@shared/types.ts';

  let canvas: HTMLCanvasElement;
  const initialScene = new URLSearchParams(location.search).get('scene');
  let mode = $state<'hologram' | 'clinic' | 'lounge'>(initialScene === 'clinic' || initialScene === 'lounge' ? initialScene : 'hologram');
  let angle = $state(0);
  let reduced = $state(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let status = $state('Loading the room…');
  let error = $state('');
  let setView: (()=>void) | null = null;
  let react: ((state: string)=>void) | null = null;
  let stateName = $state('Welcome');
  const descriptions = {
    hologram: 'A face made of light.', clinic: 'The clinical suite.', lounge: 'A place to talk.',
  };
  function choose(next: typeof mode) { mode=next; angle=0; history.replaceState(null, '', `/studio?scene=${next}`); setView?.(); }
  function expression(name: string) { stateName=name; react?.(name); }

  onMount(() => {
    document.title = 'Ese · Studio preview';
    const stage = new Stage(canvas);
    const lounge = new LoungeEnvironment({ particles:true, ground:false });
    const clinic = new ClinicalEnvironment({ particles:true });
    stage.scene.add(lounge.group,clinic.group);
    const avatar = new EseAvatar(); avatar.mount(stage.scene);
    let disposed=false;
    void avatar.load().then(()=> {
      if (!disposed) { avatar.setOutfit('clinical'); status='Live 3D preview'; }
    }).catch(()=>{error='Character assets could not load. The rooms are still available.';});
    const face = new HoloFaceMesh3D(studioFace(),100);
    stage.scene.add(face.group);
    face.highlightRegions([{region:'cheekLeft',tone:'bad'},{region:'forehead',tone:'neutral'},{region:'chin',tone:'neutral'}]);
    const labels = [new HoloCard(.50,.21),new HoloCard(.50,.10),new HoloCard(.50,.10)];
    labels[0].drawHeadline('ILLUSTRATIVE PREVIEW', 'Surface detail', 0, '', 'A light-field study. No skin measurement.', TONE_NEUTRAL, .72, {value:'3D',unit:'LANDMARK SURFACE'});
    labels[1].drawMetric('Texture',42,'preview',TONE_NEUTRAL,.42,{value:'Visible',unit:''});
    labels[2].drawMetric('Redness',38,'preview',TONE_BAD,.38,{value:'Localized',unit:''});
    labels.forEach((card)=> { card.mesh.renderOrder=120; stage.scene.add(card.mesh); card.setReveal(1); });
    const projector = new THREE.Group();
    const rings: THREE.Mesh[]=[];
    const ringMat=new THREE.MeshBasicMaterial({color:0xa0b6ff,transparent:true,opacity:.7,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false});
    for(const radius of [.26,.29,.34]) {
      const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.002,4,96),ringMat);
      ring.rotation.x=Math.PI/2; ring.renderOrder=101; projector.add(ring); rings.push(ring);
    }
    stage.scene.add(projector);
    const pointer=new THREE.Vector3(0,1.6,2);
    const directions:Record<string,CharacterDirective>={
      Welcome:{state:'IDLE',expression:'warm',gesture:'small_wave',intensity:.6},
      Listening:{state:'LISTENING',expression:'curious',gesture:'none',intensity:.55},
      Thinking:{state:'THINKING',expression:'focused',gesture:'head_tilt',intensity:.5},
      Explaining:{state:'EXPLAINING',expression:'warm',gesture:'open_palms',intensity:.6},
    };
    react=(name)=>avatar.applyDirective(directions[name]);
    react('Welcome');
    let portrait=false;
    setView=()=> {
      const hologram=mode==='hologram'; portrait=stage.aspect<1.1;
      const narrow=stage.aspect<.65;
      lounge.setPresence(mode==='lounge'?1:0); clinic.setPresence(mode==='lounge'?0:1);
      avatar.root.visible=true; face.setPresence(hologram?1:0);
      labels.forEach(card=>card.setReveal(hologram?1:0)); projector.visible=hologram;
      stage.scene.background=mode==='lounge'?lounge.background:clinic.background;
      if(hologram) {
        stage.setShot({position:new THREE.Vector3(0,1.5,narrow?2.6:portrait?2.35:1.85),target:new THREE.Vector3(0,1.46,0),fov:narrow?48:44},.7);
        avatar.root.position.set(narrow?-.27:portrait?-.39:-.58,narrow?.22:portrait?.055:-.09,-.12);
        avatar.root.scale.setScalar(narrow?.85:portrait?.91:1);
        face.group.position.set(narrow?.18:portrait?.27:.05,portrait?1.76:1.57,0); face.group.scale.setScalar(narrow?.48:portrait?.57:.76);
        projector.position.set(face.group.position.x,face.group.position.y-(portrait?.36:.43),0);
        projector.scale.setScalar(narrow?.72:portrait?.85:1);
        labels.forEach((card,i)=>card.place(new THREE.Vector3(narrow?.12:portrait?.18:.73,portrait?1.29-i*.16:1.73-i*.16,.01),stage.camera.position));
      } else {
        avatar.root.position.set(portrait ? -.32 : -.85, 0, -.35);
        avatar.root.scale.setScalar(1);
        const orbit=Number(angle)*Math.PI/180;
        stage.setShot({position:new THREE.Vector3(Math.sin(orbit)*1.3,1.65,1.75),target:new THREE.Vector3(Math.sin(orbit)*2.1,1.48,-4.3),fov:portrait?80:65},.45);
      }
    };
    setView();
    let time=0, statTime=0;
    stage.onFrame=(dt)=> {
      if(!reduced) time+=dt;
      lounge.update(dt,time); clinic.update(dt,time); face.update(dt,time);
      avatar.update(dt,{elapsed:time,gazeTarget:pointer,speechLevel:0,reducedMotion:reduced});
      labels.forEach((card,i)=>card.update(dt,time,mode==='hologram'?1:0,i));
      statTime+=dt;
      if(statTime>1) {statTime=0;const s=stage.stats();status=`Live 3D · ${s.calls} draws · ${Math.round(s.triangles/1000)}k triangles`;}
    };
    stage.start();
    const resize=()=>{stage.resize();setView?.();};
    const move=(event:PointerEvent)=>{
      const rect=canvas.getBoundingClientRect();
      pointer.set((event.clientX/rect.width-.5)*1.4,1.7-(event.clientY/rect.height-.5)*.4,1.5);
    };
    window.addEventListener('resize',resize);canvas.addEventListener('pointermove',move);
    return()=>{
      disposed=true;setView=null;react=null;
      window.removeEventListener('resize',resize);canvas.removeEventListener('pointermove',move);
      avatar.dispose(); face.dispose(); labels.forEach(card=>card.dispose());
      rings.forEach(ring=>ring.geometry.dispose());ringMat.dispose();
      lounge.dispose();clinic.dispose();stage.dispose();
    };
  });
</script>

<canvas bind:this={canvas} aria-label="Interactive 3D studio preview"></canvas>
<header>
  <a href="/" class="wordmark">ESE <span>STUDIO</span></a>
  <a href="/" class="back">Open the app <span>↗</span></a>
</header>
<div class="intro-copy"><p class="eyebrow">{mode==='hologram'?'HOLOGRAPHIC CONSULTATION':'SPACES / '+(mode==='clinic'?'02':'01')}</p><h1>{descriptions[mode]}</h1></div>
{#if error}<p class="error" role="alert">{error}</p>{/if}
<aside aria-label="Preview controls">
  <div class="switcher" role="group" aria-label="Preview scene">
    <button class:active={mode==='lounge'} aria-pressed={mode==='lounge'} onclick={()=>choose('lounge')}>01 <span>Lounge</span></button>
    <button class:active={mode==='clinic'} aria-pressed={mode==='clinic'} onclick={()=>choose('clinic')}>02 <span>Clinic</span></button>
    <button class:active={mode==='hologram'} aria-pressed={mode==='hologram'} onclick={()=>choose('hologram')}>03 <span>Hologram</span></button>
  </div>
  {#if mode==='hologram'}
    <div class="secondary" role="group" aria-label="Character expression">
      {#each ['Welcome','Listening','Thinking','Explaining'] as name}<button class:chosen={stateName===name} onclick={()=>expression(name)}>{name}</button>{/each}
    </div>
  {:else}
    <label class="orbit">Look around <input aria-label="Room viewing angle" type="range" min="-30" max="30" step="1" bind:value={angle} oninput={()=>setView?.()} /></label>
  {/if}
  <div class="meta"><span>{mode==='hologram'?'Illustrative mesh · no camera or scan used':status}</span><label><input type="checkbox" bind:checked={reduced}/> Stillness</label></div>
</aside>

<style>
  :global(body){margin:0;overflow:hidden;background:#080b17;}
  canvas{position:fixed;inset:0;width:100%;height:100%;display:block;}
  header{position:fixed;inset:0 0 auto;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:26px 32px;background:linear-gradient(#060914a6,transparent);}
  a{color:#e9e7ff;text-decoration:none;}
  .wordmark{font-size:19px;letter-spacing:.3em;font-weight:300;}.wordmark span{font-size:9px;letter-spacing:.18em;margin-left:13px;color:#aaa6ca;}
  .back{font-size:11px;color:#d0cde4;}.back span{margin-left:12px;color:#aab4ff;}
  .intro-copy{position:fixed;z-index:2;top:105px;left:32px;pointer-events:none;text-shadow:0 2px 20px #000;}
  .eyebrow{font-size:9px;letter-spacing:.25em;color:#c4bfe1;margin:0 0 12px;}h1{font-weight:300;font-size:28px;letter-spacing:-.035em;margin:0;color:#f1edff;}
  aside{position:fixed;z-index:4;bottom:20px;left:50%;transform:translateX(-50%);width:min(550px,calc(100% - 40px));padding:13px 16px 11px;border:1px solid #c4bcff30;border-radius:17px;background:linear-gradient(130deg,#16182ee8,#080d18ed);backdrop-filter:blur(20px);box-shadow:0 15px 70px #0008;color:#d2cce3;}
  .switcher{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;}button{font:inherit;cursor:pointer;}
  .switcher button{border:1px solid transparent;border-radius:9px;background:transparent;color:#87879f;font-size:10px;padding:10px;display:flex;gap:11px;align-items:center;justify-content:center;}
  .switcher button span{font-size:12px;color:#c4bfd6;}.switcher button.active{border-color:#a6a7ed50;background:#b9abff12;color:#b6b1ff;}.switcher button.active span{color:#f1eaff;}
  .secondary{display:flex;justify-content:center;gap:6px;padding-top:13px;}.secondary button{border:0;padding:4px 8px;border-radius:5px;background:transparent;color:#9c96b0;font-size:10px;}.secondary button.chosen{color:#efe8ff;background:#abb1ff13;}
  .meta{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:9px;color:#918ca7;margin-top:13px;}.meta label{display:flex;gap:5px;align-items:center;white-space:nowrap;}.meta input{accent-color:#b4a5ef;width:12px;height:12px;}
  .orbit{display:flex;align-items:center;gap:15px;font-size:10px;margin-top:14px;}.orbit input{flex:1;accent-color:#a6a1e4;height:3px;}
  .error{position:fixed;top:180px;left:32px;color:#ecc2b2;font-size:12px;}
  @media(max-width:650px){header{padding:20px;}.wordmark{font-size:15px;}.wordmark span{font-size:8px;margin-left:6px;}.intro-copy{left:22px;top:82px;}h1{font-size:24px;}.eyebrow{font-size:8px;}aside{bottom:14px;width:calc(100% - 28px);padding:11px;} .switcher button{gap:7px;}.secondary{gap:0;}.meta{font-size:8px;}}
  @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto;}}
</style>
