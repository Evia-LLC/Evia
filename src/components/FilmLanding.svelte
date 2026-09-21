<script lang="ts">
  import { onMount } from 'svelte';
  let { signedIn = false, onSignup, onSignIn, onExplore }: {
    signedIn?: boolean; onSignup: () => void; onSignIn: () => void; onExplore: () => void;
  } = $props();
  let film: HTMLVideoElement;
  let playing = $state(false);
  let unavailable = $state(false);
  let reduce = $state(false);
  onMount(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { reduce = motion.matches; if (reduce) film?.pause(); };
    sync(); motion.addEventListener('change', sync);
    if (!reduce) void film?.play().catch(() => { playing = false; });
    const visibility = () => { if (document.hidden) film?.pause(); else if (!reduce) void film?.play().catch(() => {}); };
    document.addEventListener('visibilitychange', visibility);
    return () => { motion.removeEventListener('change', sync); document.removeEventListener('visibilitychange', visibility); film?.pause(); };
  });
  function toggleFilm() { if (film.paused) void film.play().catch(() => { unavailable = true; }); else film.pause(); }
</script>

<main class="arrival">
  <video bind:this={film} class="arrival__film" muted loop playsinline preload="metadata"
    poster="/film/ese-consultation-poster.webp" aria-label="A silent 3D film of Ese gently scanning a client's face"
    onplay={() => playing = true} onpause={() => playing = false} onerror={() => unavailable = true}>
    <source src="/film/ese-consultation.mp4" type="video/mp4" onerror={() => unavailable = true} />
    <track kind="captions" />
  </video>
  <div class="arrival__shade" aria-hidden="true"></div>
  <header>
    <a class="mark" href="/" aria-label="Ese home">ese<span>YOUR SKIN. UNDERSTOOD.</span></a>
    <div class="nav-actions"><span class="private">A space just for you</span><button class="sign-in" onclick={onSignIn}>{signedIn ? 'Enter the lounge' : 'Sign in'} <span>↗</span></button></div>
  </header>
  <section class="invitation" aria-labelledby="arrival-title">
    <p class="eyebrow"><span></span> MEET YOUR SKIN COMPANION</p>
    <h1 id="arrival-title">A little science.<br/>A lot of <em>understanding.</em></h1>
    <p class="intro">Meet Ese. A calmer place to talk about your skin,<br class="wide"/> understand what you see, and find your next step.</p>
    <div class="actions"><button class="begin" onclick={onSignup}>{signedIn ? 'Return to Ese' : 'Sign up'} <span aria-hidden="true">↗</span></button><button class="explore" onclick={onExplore}>Look around first <span aria-hidden="true">→</span></button></div>
    <p class="welcome-note">{signedIn ? 'Your lounge is ready whenever you are.' : 'Your welcome includes an AI-generated voice. You can mute it anytime.'}</p>
  </section>
  <footer>
    <div class="journey" aria-label="Your journey"><span><b>01</b> A conversation</span><i></i><span><b>02</b> A closer look</span><i></i><span><b>03</b> A little clarity</span></div>
    <div class="film-credit"><span>{unavailable ? 'Film preview unavailable' : 'A 3D consultation film · sound off'}</span><button onclick={toggleFilm} aria-label={playing ? 'Pause background film' : 'Play background film'} title={playing ? 'Pause film' : 'Play film'}>{playing ? 'Ⅱ' : '▷'}</button></div>
  </footer>
</main>

<style>
  .arrival{position:fixed;inset:0;z-index:15;overflow:auto;min-height:100svh;background:#18151c;color:#f4eee8;}
  .arrival__film{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;}
  .arrival__shade{position:fixed;inset:0;pointer-events:none;background:linear-gradient(90deg,#171319f2 0%,#171319c9 33%,#15131b45 67%,#100e1926),linear-gradient(0deg,#0f111be6,transparent 35%,transparent 70%,#17131970);}
  header{position:relative;display:flex;justify-content:space-between;align-items:center;padding:30px 5vw;z-index:1;}
  .mark{font-family:Georgia,'Times New Roman',serif;color:#f9eee8;text-decoration:none;font-size:51px;line-height:.85;letter-spacing:-.065em;display:flex;align-items:center;gap:25px;}
  .mark span{font-family:var(--font);font-size:8px;letter-spacing:.18em;color:#c9bdbb;line-height:1.6;max-width:105px;}
  .nav-actions{display:flex;align-items:center;gap:28px;}.private{font-size:11px;color:#d4c9c5;}.sign-in{font:inherit;font-size:12px;color:#eee7e2;background:#ffffff08;border:1px solid #ffffff3b;border-radius:50px;padding:12px 20px;cursor:pointer;}.sign-in span{margin-left:22px;}
  .invitation{position:relative;z-index:1;margin:12vh 0 12vh 7vw;max-width:780px;}.eyebrow{font-size:10px;letter-spacing:.22em;color:#ccbfb7;display:flex;align-items:center;gap:10px;margin-bottom:28px;}.eyebrow span{width:5px;height:5px;background:#d6b8f5;border-radius:50%;box-shadow:0 0 20px #b88cfd;}
  h1{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:clamp(44px,5.65vw,87px);line-height:1.07;letter-spacing:-.065em;margin:0 0 27px;}h1 em{font-weight:400;color:#dfc4cd;}
  .intro{font-size:14px;line-height:1.8;color:#ccc1be;max-width:410px;}.actions{display:flex;gap:25px;align-items:center;margin-top:33px;}button{font-family:inherit;cursor:pointer;}.begin{border:1px solid #f1dfe3;background:#eddae0;color:#332731;border-radius:50px;padding:17px 24px;font-size:13px;min-width:168px;display:flex;align-items:center;justify-content:space-between;gap:35px;}.begin:hover{background:#fae8ec;}.begin span{font-size:18px;}.explore{border:0;background:none;color:#e6dad7;font-size:12px;padding:14px 0;}.explore span{margin-left:13px;}.welcome-note{font-size:9px;color:#b6a8a9;margin-top:17px;max-width:380px;line-height:1.6;}
  footer{position:relative;display:flex;justify-content:space-between;align-items:center;gap:24px;margin:0 5vw;padding:25px 0 28px;border-top:1px solid #ffffff21;}.journey{display:flex;align-items:center;gap:20px;font-size:11px;color:#d3c9c5;}.journey span{display:flex;gap:10px;white-space:nowrap;}.journey b{font-size:9px;font-weight:400;color:#95888e;}.journey i{width:30px;height:1px;background:#b19ba33d;}.film-credit{display:flex;align-items:center;gap:12px;font-size:9px;color:#b4aab4;}.film-credit button{border:1px solid #ccbdda50;border-radius:50%;width:34px;height:34px;background:#ffffff08;color:#ddd0df;}
  button:focus-visible,a:focus-visible{outline:2px solid #e7bde0;outline-offset:5px;}
  @media(min-height:780px){footer{position:absolute;bottom:0;left:0;right:0;}.invitation{margin-top:17vh;margin-bottom:20vh;}}
  @media(max-width:760px){header{padding:24px;}.mark{font-size:44px;gap:14px;}.mark span{font-size:6px;max-width:74px;}.private{display:none;}.sign-in{padding:10px 14px;font-size:10px;}.sign-in span{margin-left:10px;}.arrival__film{object-position:65% center;}.arrival__shade{background:linear-gradient(90deg,#171319b5,#17131920),linear-gradient(0deg,#13101bef,#18121aa9 50%,#14121d22 85%);}.invitation{margin:28vh 24px 30px;max-width:90%;}h1{font-size:clamp(41px,8.3vw,61px);}.eyebrow{font-size:8px;letter-spacing:.17em;margin-bottom:20px;}.intro{font-size:12px;max-width:315px;}.wide{display:none;}.actions{gap:18px;margin-top:23px;}.begin{padding:14px 22px;min-width:146px;}.explore{font-size:11px;}.welcome-note{font-size:8px;max-width:270px;}footer{position:relative!important;margin:0 24px;padding:18px 0;align-items:flex-start;flex-direction:column;gap:18px;}.journey{gap:10px;font-size:9px;}.journey i{width:13px;}.journey span{gap:6px;}.film-credit{font-size:8px;}}
  @media(prefers-reduced-motion:reduce){.arrival__film{transition:none;}}
</style>
