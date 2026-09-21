import * as THREE from 'three';

/** A waist-mounted light field with a world-space wake, shared by every room. */
export class CharacterPortal {
  readonly group = new THREE.Group();
  readonly trail: THREE.Points;
  private materials: THREE.ShaderMaterial[] = [];
  private rings: THREE.Mesh[] = [];
  private positions = new Float32Array(72 * 3);
  private ages = new Float32Array(72).fill(9);
  private cursor = 0;
  private clock = 0;
  private last = new THREE.Vector3();
  private point = new THREE.Vector3();
  private initialized = false;
  private disposed = false;

  constructor(y = 1.02) {
    this.group.name = 'EseAttachedPortal';
    this.group.position.y = y;
    const field = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, strength: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float strength;
        void main(){vec2 p=(vUv-.5)*2.;float r=length(p);float a=atan(p.y,p.x);
        float rim=exp(-pow((r-.79)*28.,2.));float inner=exp(-pow((r-.57)*24.,2.));
        float spiral=pow(max(0.,sin(a*3.+r*24.-time*1.4)),9.)*.22;
        float soft=pow(max(0.,1.-r),2.)*.32;float alpha=(rim*.8+inner*.28+spiral+soft)*(1.-smoothstep(.88,1.,r));
        vec3 color=mix(vec3(.47,.35,1.),vec3(.58,.94,1.),rim*.8+soft);
        gl_FragColor=vec4(color,alpha*strength);}`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.materials.push(field);
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(.86, .72), field);
    disc.rotation.x = -Math.PI / 2;
    this.group.add(disc);
    const veil = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, strength: { value: 1 } },
      vertexShader: field.vertexShader,
      fragmentShader: `varying vec2 vUv;uniform float time;uniform float strength;
        void main(){float strand=pow(max(0.,sin(vUv.x*94.+vUv.y*10.-time*1.5)),12.);
        float falloff=pow(vUv.y,2.)*(.06+strand*.12);gl_FragColor=vec4(.48,.44,1.,falloff*strength);}`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.materials.push(veil);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(.285, .015, .34, 64, 1, true), veil);
    funnel.position.y = -.17;
    this.group.add(funnel);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.29 + i * .047, .0026 - i * .0005, 5, 96),
        new THREE.MeshBasicMaterial({ color: i === 1 ? 0xf4dbff : 0x9ccfff, transparent: true,
          opacity: .85 - i * .18, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -.018 * i;
      ring.scale.y = .82;
      this.group.add(ring); this.rings.push(ring);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('age', new THREE.BufferAttribute(this.ages, 1).setUsage(THREE.DynamicDrawUsage));
    this.trail = new THREE.Points(geometry, new THREE.ShaderMaterial({
      vertexShader: `attribute float age;varying float a;void main(){a=max(0.,1.-age/1.8);vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=min(18.,70.*a/max(.3,-p.z));gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying float a;void main(){float r=length(gl_PointCoord-.5)*2.;float g=pow(max(0.,1.-r),3.);gl_FragColor=vec4(.65,.63,1.,g*a*.55);}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.trail.name = 'EsePortalWake'; this.trail.frustumCulled = false;
    this.trail.matrixAutoUpdate = false;
  }

  update(dt: number, elapsed: number, reduced: boolean, speech = 0): void {
    if (this.disposed) return;
    // Keep old particles in world space even if the mounting parent moves.
    if (this.trail.parent) {
      this.trail.parent.updateWorldMatrix(true, false);
      this.trail.matrix.copy(this.trail.parent.matrixWorld).invert();
      this.trail.matrixWorldNeedsUpdate = true;
    }
    for (const material of this.materials) {
      material.uniforms.time.value = reduced ? 0 : elapsed;
      material.uniforms.strength.value = .85 + speech * .18;
    }
    this.rings.forEach((ring, i) => { ring.rotation.z = reduced ? 0 : elapsed * (.09 + i * .05); });
    this.group.getWorldPosition(this.point);
    if (!this.initialized) { this.last.copy(this.point); this.initialized = true; }
    this.clock += dt;
    const moved = this.last.distanceToSquared(this.point) > .000012;
    if (!reduced && moved && this.clock > .035) {
      this.clock = 0;
      const i = this.cursor++ % this.ages.length;
      const phase = i * 2.399;
      this.positions[i * 3] = this.point.x + Math.sin(phase) * .18;
      this.positions[i * 3 + 1] = this.point.y - .04;
      this.positions[i * 3 + 2] = this.point.z + Math.cos(phase) * .13;
      this.ages[i] = 0;
    }
    this.last.copy(this.point);
    for (let i = 0; i < this.ages.length; i++) {
      this.ages[i] += dt;
      if (this.ages[i] < 1.8) this.positions[i * 3 + 1] -= dt * .045;
    }
    let visible = true;
    for (let parent: THREE.Object3D | null = this.group; parent; parent = parent.parent) visible &&= parent.visible;
    this.trail.visible = !reduced && visible;
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.age.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    this.trail.geometry.dispose(); (this.trail.material as THREE.Material).dispose();
    this.group.removeFromParent(); this.trail.removeFromParent();
  }
}
