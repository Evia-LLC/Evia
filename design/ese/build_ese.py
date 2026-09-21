"""Create the rigged waist-up Ese reference interpretation in Blender 4.5 LTS.
Base humanoid CC0: TalkingHead/MPFB. No portrait planes or baked animation sprites.
"""
import bpy,math,json,random,sys,struct,argparse
import numpy as np
from pathlib import Path
from mathutils import Vector,Quaternion,Matrix
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=HERE.parent/'character/elohim.blend');parser.add_argument('--output-dir',type=Path,default=HERE);parser.add_argument('--preview-only',action='store_true');parser.add_argument('--samples',type=int,default=32);parser.add_argument('--fast',action='store_true')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT=args.output_dir.resolve();OUT.mkdir(parents=True,exist_ok=True)
random.seed(19)
bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
scene=bpy.context.scene;rig=bpy.data.objects['ELOHIM_Rig'];body=bpy.data.objects['ELOHIM_Skin']
rig.animation_data.action=None;rig.data.pose_position='REST'
for o in list(scene.objects):
 o.hide_set(False);o.hide_render=False
 if o.type in {'LIGHT','CAMERA'}:bpy.data.objects.remove(o,do_unlink=True)
for pb in rig.pose.bones:pb.rotation_mode='QUATERNION';pb.rotation_quaternion=Quaternion();pb.location=(0,0,0)
def subset(src,ids,name,material=None,keys=True):
 ids=sorted(set(ids));mp={v:i for i,v in enumerate(ids)}
 polys=[p for p in src.data.polygons if all(v in mp for v in p.vertices)]
 me=bpy.data.meshes.new(name);me.from_pydata([src.data.vertices[i].co for i in ids],[],[[mp[v] for v in p.vertices] for p in polys]);me.update()
 o=bpy.data.objects.new(name,me);scene.collection.objects.link(o);o.matrix_world=src.matrix_world.copy()
 if material:me.materials.append(material)
 else:
  for m in src.data.materials:me.materials.append(m)
 for uv in src.data.uv_layers:
  new=me.uv_layers.new(name=uv.name)
  for pn,po in zip(me.polygons,polys):
   for a,b in zip(pn.loop_indices,po.loop_indices):new.data[a].uv=uv.data[b].uv
 for g in src.vertex_groups:o.vertex_groups.new(name=g.name)
 for i,old in enumerate(ids):
  for w in src.data.vertices[old].groups:o.vertex_groups[w.group].add([i],w.weight,'REPLACE')
 if keys and src.data.shape_keys:
  for k in src.data.shape_keys.key_blocks:
   nk=o.shape_key_add(name=k.name)
   for i,old in enumerate(ids):nk.data[i].co=k.data[old].co
   nk.value=k.value
 mod=o.modifiers.new('ELOHIM_Skinning','ARMATURE');mod.object=rig;o.parent=rig
 for p in me.polygons:p.use_smooth=True
 for pn,po in zip(me.polygons,polys):pn.material_index=0 if material else po.material_index
 return o

def relaxed_default(path):
 p=Path(path);raw=p.read_bytes();n,kind=struct.unpack_from('<II',raw,12);doc=json.loads(raw[20:20+n]);off=20+n;bl,bt=struct.unpack_from('<II',raw,off);blob=raw[off+8:off+8+bl]
 idle=next(a for a in doc['animations'] if a['name']=='Idle')
 widths={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
 for ch in idle['channels']:
  target=ch['target'];prop=target['path']
  if prop not in {'rotation','translation','scale'}:continue
  samp=idle['samplers'][ch['sampler']];acc=doc['accessors'][samp['output']];view=doc['bufferViews'][acc['bufferView']]
  pos=view.get('byteOffset',0)+acc.get('byteOffset',0);width=widths[acc['type']]
  values=list(struct.unpack_from('<'+'f'*width,blob,pos));doc['nodes'][target['node']][prop]=values
 for m in doc.get('materials',[]):
  if m.get('name')=='ELOHIM_Rose_Lips':m['pbrMetallicRoughness']['baseColorFactor']=[.88,.44,.45,1]
  if m.get('name')=='ELOHIM_Brunette_Cards':m['pbrMetallicRoughness']['baseColorFactor']=[.58,.47,.42,1]
 doc['scenes'][doc.get('scene',0)].setdefault('extras',{}).update({'character':'Ese','portalY':1.025,'units':'metres','frontAxis':'+Z'})
 doc.setdefault('asset',{})['copyright']='Base humanoid: TalkingHead / MPFB, CC0. Ese custom styling and animations.'
 js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);blob+=b'\0'*((-len(blob))%4)
 p.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(blob))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(blob),0x004e4942)+blob)
 return doc

def compact_morph_normals(source,destination=None,epsilon=1e-7):
 source=Path(source);destination=Path(destination or source);raw=source.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);blob=bytearray(raw[28+length:]);accessors=doc['accessors'];views=doc['bufferViews']
 def normal_values(index):
  a=accessors[index];out=[(0.,0.,0.)]*a['count']
  if 'bufferView' in a:
   v=views[a['bufferView']];offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',12);out=[struct.unpack_from('<fff',blob,offset+k*stride) for k in range(a['count'])]
  if 'sparse' in a:
   s=a['sparse'];iv=views[s['indices']['bufferView']];vv=views[s['values']['bufferView']];fmt={5121:'B',5123:'H',5125:'I'}[s['indices']['componentType']];idx=struct.unpack_from('<'+fmt*s['count'],blob,iv.get('byteOffset',0)+s['indices'].get('byteOffset',0));offset=vv.get('byteOffset',0)+s['values'].get('byteOffset',0)
   for k,i in enumerate(idx):out[i]=struct.unpack_from('<fff',blob,offset+k*12)
  return out
 def add_view(data):
  blob.extend(b'\0'*((-len(blob))%4));idx=len(views);views.append({'buffer':0,'byteOffset':len(blob),'byteLength':len(data)});blob.extend(data);return idx
 normals={t['NORMAL'] for m in doc['meshes'] for p in m['primitives'] for t in p.get('targets',[]) if 'NORMAL' in t}
 for index in sorted(normals):
  a=accessors[index];vals=normal_values(index);keep=[i for i,v in enumerate(vals) if max(abs(x) for x in v)>epsilon]
  for key in ['bufferView','byteOffset','sparse','min','max']:a.pop(key,None)
  if keep:
   component=5123 if a['count']<=65535 else 5125;fmt='H' if component==5123 else 'I';iv=add_view(struct.pack('<'+fmt*len(keep),*keep));vv=add_view(b''.join(struct.pack('<fff',*vals[i]) for i in keep));a['sparse']={'count':len(keep),'indices':{'bufferView':iv,'componentType':component},'values':{'bufferView':vv}}
 used=set()
 for m in doc['meshes']:
  for p in m['primitives']:
   used.update(p['attributes'].values())
   if 'indices' in p:used.add(p['indices'])
   for t in p.get('targets',[]):used.update(t.values())
 for s in doc.get('skins',[]):
  if 'inverseBindMatrices' in s:used.add(s['inverseBindMatrices'])
 for a in doc.get('animations',[]):
  for s in a['samplers']:used.update((s['input'],s['output']))
 order=sorted(used);amap={old:new for new,old in enumerate(order)};doc['accessors']=[accessors[i] for i in order]
 for m in doc['meshes']:
  for p in m['primitives']:
   p['attributes']={k:amap[v] for k,v in p['attributes'].items()}
   if 'indices' in p:p['indices']=amap[p['indices']]
   for t in p.get('targets',[]):
    for k,v in t.items():t[k]=amap[v]
 for s in doc.get('skins',[]):
  if 'inverseBindMatrices' in s:s['inverseBindMatrices']=amap[s['inverseBindMatrices']]
 for a in doc.get('animations',[]):
  for s in a['samplers']:s['input']=amap[s['input']];s['output']=amap[s['output']]
 usedviews={im['bufferView'] for im in doc.get('images',[]) if 'bufferView' in im}
 for a in doc['accessors']:
  if 'bufferView' in a:usedviews.add(a['bufferView'])
  if 'sparse' in a:usedviews.update((a['sparse']['indices']['bufferView'],a['sparse']['values']['bufferView']))
 vorder=sorted(usedviews);vmap={old:new for new,old in enumerate(vorder)};newblob=bytearray();newviews=[]
 for i in vorder:
  v=views[i];newblob.extend(b'\0'*((-len(newblob))%4));nv=dict(v);nv['byteOffset']=len(newblob);newblob.extend(blob[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]);newviews.append(nv)
 for a in doc['accessors']:
  if 'bufferView' in a:a['bufferView']=vmap[a['bufferView']]
  if 'sparse' in a:
   for key in ['indices','values']:a['sparse'][key]['bufferView']=vmap[a['sparse'][key]['bufferView']]
 for im in doc.get('images',[]):
  if 'bufferView' in im:im['bufferView']=vmap[im['bufferView']]
 newblob.extend(b'\0'*((-len(newblob))%4));doc['bufferViews']=newviews;doc['buffers']=[{'byteLength':len(newblob)}];doc.setdefault('asset',{}).setdefault('extras',{})['morphNormalSparseEpsilon']=epsilon
 js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
 destination.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(newblob))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(newblob),0x004e4942)+newblob)
 return {'bytes':destination.stat().st_size,'MiB':round(destination.stat().st_size/2**20,3),'normalTargetsRetained':len(normals),'epsilon':epsilon}

# Crop the anatomical lower body, while retaining the complete hands/arms.
old=body;old.name='OriginalSkin';body=subset(old,[v.index for v in old.data.vertices if v.co.z>=1.025 or abs(v.co.x)>.26],'ELOHIM_Skin',None,True)
bpy.data.objects.remove(old,do_unlink=True)
# Source sleeve tailoring is retained with its original arm weights.
oldcoat=bpy.data.objects['NORMAL_Charcoal_Crepe']
sleeve_ids=[v.index for v in oldcoat.data.vertices if abs(v.co.x)>.125 and sum(w.weight for w in v.groups if oldcoat.vertex_groups[w.group].name in ['LeftArm','RightArm','LeftForeArm','RightForeArm'])>.12]
sleeves=subset(oldcoat,sleeve_ids,'ESE_Coat_Sleeves',None,False)
# Strip former uniforms, shoes, bun and jewelry; keep scalp and all facial meshes.
for o in list(scene.objects):
 if o.name.startswith(('NORMAL_','CLINICAL_','ELOHIM_Updo_','ELOHIM_Left_Pump','ELOHIM_Right_Pump','ELOHIM_Earring_')):bpy.data.objects.remove(o,do_unlink=True)

def mat(name,color,rough=.5,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
ivory=mat('ESE_Pearl_Lilac_Coat',(.76,.735,.85),.58)
collarmat=mat('ESE_Ivory_Lapel',(.85,.82,.90),.5)
purple=mat('ESE_Amethyst',(.25,.045,.46),.22,.28)
stitch=mat('ESE_Lavender_Seams',(.42,.30,.58),.6)
topmat=mat('ESE_Charcoal_V_Neck',(.022,.018,.029),.76)
gold=mat('ESE_Champagne_Metal',(.60,.43,.22),.24,.75)
blonde=mat('ESE_Honey_Blonde',(.34,.21,.100),.48)
blonde_light=mat('ESE_Champagne_Blonde',(.42,.275,.136),.48)
blonde_dark=mat('ESE_Blonde_Shadow',(.26,.151,.063),.52)
hairmats=[blonde,blonde_light,blonde_dark]
# New fitted torso pieces use continuous spine weights. The original body has no
# covered torso geometry, so nearest-skin transfer would incorrectly pick hands/neck.
def bind(o,bone=None):
 if o.type!='MESH':
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');o=bpy.context.object
 if bone:
  if bone not in o.vertex_groups:o.vertex_groups.new(name=bone)
  o.vertex_groups[bone].add(list(range(len(o.data.vertices))),1,'REPLACE')
 else:
  for name in ['Spine','Spine1','Spine2']:
   if name not in o.vertex_groups:o.vertex_groups.new(name=name)
  for v in o.data.vertices:
   z=(o.matrix_world@v.co).z
   if z<1.20:
    t=max(0,min(1,(z-1.10)/.10));weights={'Spine':1-t,'Spine1':t}
   else:
    t=max(0,min(1,(z-1.25)/.11));weights={'Spine1':1-t,'Spine2':t}
   for name,weight in weights.items():
    if weight>0:o.vertex_groups[name].add([v.index],weight,'REPLACE')
 mod=o.modifiers.new('Ese_Skinning','ARMATURE');mod.object=rig;o.parent=rig
 for p in o.data.polygons:p.use_smooth=True
 return o

def mesh(name,verts,faces,material,bone=None):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);scene.collection.objects.link(o);me.materials.append(material);return bind(o,bone)

def tube(name,points,radii,material,bone='Head',sides=8,flatten=1):
 pts=[Vector(p) for p in points];vs=[];fs=[]
 for i,p in enumerate(pts):
  t=(pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]).normalized();u=t.cross(Vector((0,1,0)))
  if u.length<.01:u=t.cross(Vector((1,0,0)))
  u.normalize();v=t.cross(u).normalized()
  for j in range(sides):
   a=j*math.tau/sides;vs.append(p+radii[i]*(math.cos(a)*u+math.sin(a)*v*flatten))
 for i in range(len(pts)-1):
  for j in range(sides):a=i*sides+j;b=i*sides+(j+1)%sides;fs.append((a,b,b+sides,a+sides))
 fs+=[tuple(range(sides-1,-1,-1)),tuple((len(pts)-1)*sides+j for j in range(sides))]
 return mesh(name,vs,fs,material,bone)

def ball(name,loc,scale,material,bone='Head',segments=24,rings=12):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material);return bind(o,bone)

def bezier(points,count=32):
 # Piecewise Catmull-Rom interpolation, including endpoints.
 q=[Vector(points[0]),*[Vector(p) for p in points],Vector(points[-1])];out=[]
 for k in range(count):
  x=k/(count-1)*(len(points)-1);i=min(len(points)-2,int(x));t=x-i;a,b,c,d=q[i:i+4]
  out.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
 return out
# Warm, subtly refined lower face; all shape keys receive identical displacements.
for v in body.data.vertices:
 co=v.co;delta=Vector((0,0,0));x,y,z=co
 if z>1.55 and y<-.05:
  jaw=math.exp(-((z-1.579)/.035)**2);delta.x=-x*.055*jaw
  delta.z=.006*math.exp(-((z-1.552)/.029)**2)
 for key in body.data.shape_keys.key_blocks:key.data[v.index].co+=delta
# Iris recolouring preserves the original radial iris detail and limbal ring.
image=bpy.data.images['brown_eye'];pix=np.array(image.pixels[:],dtype=np.float32).reshape((-1,4));r,g,b=pix[:,0].copy(),pix[:,1].copy(),pix[:,2].copy()
mask=(r>g*1.38)&(r>b*1.5)&(r>.018)&(r<.48)
intensity=np.clip(r*.72+g*.25+b*.03,0,1)
pix[mask,0]=intensity[mask]*.52;pix[mask,1]=intensity[mask]*1.20;pix[mask,2]=intensity[mask]*1.72
image.pixels.foreach_set(pix.ravel());image.name='ESE_Blue_Iris';image.pack()
# Continuous sculpted scalp volume with a curved hairline, gathered at the crown.
# This replaces the ponytail hair cards, which leave a flat headband silhouette.
bpy.data.objects.remove(bpy.data.objects['ELOHIM_Brunette_Swept_Hair'],do_unlink=True)
def hair_edge(theta):
 front=max(0,-math.sin(theta));return 1.609+.109*front**3+.008*math.cos(theta)*front
hc=Vector((0,-.012,1.663));hr=Vector((.090,.140,.130))
def cap_point(theta,phi,relief=0):
 return hc+Vector(((hr.x+relief)*math.sin(phi)*math.cos(theta),(hr.y+relief)*math.sin(phi)*math.sin(theta),(hr.z+relief)*math.cos(phi)))
vs=[];fs=[];rows=26;cols=80
for i in range(rows):
 for j in range(cols):
  theta=j*math.tau/cols;limit=math.acos((hair_edge(theta)-hc.z)/hr.z);phi=.012+(limit-.012)*i/(rows-1)
  vs.append(cap_point(theta,phi))
for i in range(rows-1):
 for j in range(cols):a=i*cols+j;b=i*cols+(j+1)%cols;fs.append((a,b,b+cols,a+cols))
mesh('ESE_Gathered_Hair_Cap',vs,fs,blonde,'Head')
# Narrow strand ridges follow the cap all the way from the hairline. The side part
# sweeps diagonally into the updo rather than making two upright mirrored loops.
for j in range(82):
 theta=j*math.tau/82;limit=math.acos((hair_edge(theta)-hc.z)/hr.z);pts=[]
 for k in range(32):
  t=k/31;phi=limit*(1-t)+.13*t;twist=.20*math.sin(math.pi*t)*(1 if math.cos(theta)>0 else -1)
  pts.append(cap_point(theta+twist,phi,.0015))
 radii=[.00055+.00065*math.sin(math.pi*k/31) for k in range(32)]
 tube('ESE_Scalp_Strand',pts,radii,blonde_light if j%4 else blonde_dark,sides=5,flatten=.55)
# Soft, irregular gathered bun: low-contrast coils around overlapping lobes.
ball('ESE_Bun_Core',(.009,.063,1.813),(.065,.048,.053),blonde,segments=32,rings=18)
ball('ESE_Bun_Side_Lobe',(-.020,.054,1.825),(.038,.043,.035),blonde,segments=24,rings=16)
for j in range(12):
 a=j*math.tau/12;pts=[]
 for k in range(36):
  t=k/35;angle=a+t*(1.9+.30*math.sin(j));r=math.sin(math.pi*t)**.6
  pts.append((.009+.062*r*math.cos(angle),.063+.049*math.cos(math.pi*t),1.812+.052*r*math.sin(angle)))
 tube('ESE_Bun_Coil',pts,[.0015+.003*math.sin(math.pi*k/35)**.7 for k in range(36)],blonde_light if j%3 else blonde,sides=6,flatten=.6)
# Two intentionally asymmetric wisps, each a real skinned tapered strand bundle.
for side in [-1,1]:
 pts=bezier([(side*.031,-.145,1.719),(side*.061,-.149,1.688),(side*.078,-.155,1.644),(side*.064,-.165,1.609),(side*.076,-.145,1.567),(side*.068,-.116,1.542)],58)
 for j in range(5):
  offset=(j-2)*.0017
  path=[p+Vector((offset*math.sin(math.pi*k/57),-.0006*j,0)) for k,p in enumerate(pts)]
  tube('ESE_Face_Framing_Strand',path,[.00045+.0016*(1-k/57)**.65 for k in range(58)],hairmats[1 if j%3==0 else 0],sides=6)
# Short temple strands tuck around the ear into the bun.
for side in [-1,1]:
 for j in range(5):
  pts=bezier([(side*(.080+j*.001),-.050,1.620+j*.007),(side*.083,.001,1.668+j*.006),(side*.068,.064,1.744),(side*.032,.075,1.801)],26)
  tube('ESE_Temple_Strand',pts,[.0008+.0013*math.sin(math.pi*k/25) for k in range(26)],blonde_light if j==2 else blonde,sides=5)
# Lighter, warm taupe brows retain all expression targets; lashes stay dark.
for mname in ['ELOHIM_Eyebrows_Mat']:
 p=bpy.data.materials[mname].node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.10,.049,.020,1)
# Fabric shell with a clean open front, and a separate low V-neck camisole.
def interp(z,profile):
 for (a,x),(b,y) in zip(profile,profile[1:]):
  if a<=z<=b:return x+(y-x)*(z-a)/(b-a)
 return profile[0][1] if z<profile[0][0] else profile[-1][1]
rx_profile=[(1.01,.143),(1.12,.136),(1.22,.150),(1.32,.185),(1.40,.197),(1.438,.198),(1.472,.148),(1.498,.064)]
front_profile=[(1.01,.112),(1.12,.119),(1.22,.139),(1.32,.177),(1.40,.149),(1.438,.105),(1.472,.080),(1.498,.043)]
back_profile=[(1.01,.084),(1.12,.071),(1.22,.075),(1.32,.077),(1.40,.070),(1.438,.063),(1.472,.052),(1.498,.030)]
opening=[(1.01,.012),(1.20,.014),(1.29,.030),(1.38,.064),(1.445,.070),(1.498,.051)]
def section(z):return interp(z,rx_profile),interp(z,front_profile),interp(z,back_profile)
def front_y(x,z,offset=0):
 rx,front,back=section(z);return -.024-front*math.sqrt(max(.02,1-(x/rx)**2))-offset

def shell(name,material,top=False):
 verts=[];faces=[];rows=36;cols=64;zmax=1.488 if top else 1.498
 for i in range(rows):
  z=1.016+(zmax-1.016)*i/(rows-1);rx,front,back=section(z)
  if top:rx*=.95;front*=.95;back*=.95
  gap=max(.0001,(z-1.326)*.44) if top else interp(z,opening)
  a=math.asin(min(.95,gap/rx))
  for j in range(cols):
   angle=a+(math.tau-2*a)*j/(cols-1);x=rx*math.sin(angle);c=math.cos(angle);depth=front if c>=0 else back;y=-.024-depth*c
   # slight side seam shaping, keeps the waist tailored
   verts.append((x,y,z))
 for i in range(rows-1):
  for j in range(cols-1):a=i*cols+j;faces.append((a,a+1,a+1+cols,a+cols))
 return mesh(name,verts,faces,material)
coat=shell('ESE_Open_Lab_Coat',ivory);top=shell('ESE_Dark_V_Neck_Top',topmat,True)
# A modest neckline insert bridges the source body's intentionally absent hidden torso.
# It is real skinned geometry behind the V-neck and lapels, not a painted plane.
chestmat=mat('ESE_Warm_Neckline',(.53,.305,.205),.62)
vs=[];fs=[]
for i in range(20):
 z=1.337+.169*i/19;w=.060;yf=-.174+.108*((z-1.337)/.169)**1.3
 for j in range(20):
  x=-w+2*w*j/19;vs.append((x,yf+.22*x*x/w,z))
for i in range(19):
 for j in range(19):a=i*20+j;fs.append((a,a+1,a+21,a+20))
mesh('ESE_Neckline',vs,fs,chestmat)

# Smooth existing sleeves, retaining all interpolated shoulder/forearm weights.
sleeves.data.materials.clear();sleeves.data.materials.append(ivory)
bpy.context.view_layer.objects.active=sleeves;bpy.ops.object.select_all(action='DESELECT');sleeves.select_set(True)
sub=sleeves.modifiers.new('TailoringSmooth','SUBSURF');sub.levels=2;bpy.ops.object.modifier_move_up(modifier=sub.name);bpy.ops.object.modifier_apply(modifier=sub.name)
# Make lapels thick enough for a real edge, with restrained lavender stitchwork.
for side in [-1,1]:
 outline=[(.051,1.497),(.116,1.457),(.103,1.433),(.123,1.419),(.025,1.284),(.054,1.384)]
 coords=[Vector((side*x,front_y(x,z,.005),z)) for x,z in outline];center=sum(coords,Vector())/len(coords)
 verts=[center,*coords];faces=[(0,i+1,(i+1)%len(coords)+1) for i in range(len(coords))]
 lapel=mesh('ESE_Notched_Lapel',verts,faces,collarmat)
 # Subdivide and fit every lapel vertex to the curved chest surface.
 import bmesh
 bm=bmesh.new();bm.from_mesh(lapel.data);bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=5,use_grid_fill=True);bm.to_mesh(lapel.data);bm.free()
 for v in lapel.data.vertices:v.co.y=front_y(abs(v.co.x),v.co.z,.007)
 for mod in list(lapel.modifiers):lapel.modifiers.remove(mod)
 lapel.vertex_groups.clear();bind(lapel)
 solid=lapel.modifiers.new('TailoredEdge','SOLIDIFY');solid.thickness=.0022
 bpy.context.view_layer.objects.active=lapel;bpy.ops.object.modifier_apply(modifier=solid.name)
 edge=bezier([coords[i]+Vector((0,-.0014,0)) for i in [0,1,2,3,4]],26)
 tube('ESE_Lapel_Stitch',edge,[.00065]*len(edge),stitch,bone=None,sides=5)
 # welt pockets sit flush to the coat surface
 for z in [1.167]:
  pts=[(side*x,front_y(x,z,.003),z+.01*(x-.095)) for x in [.073,.086,.100,.114,.126]]
  tube('ESE_Pocket_Welt',pts,[.003]*len(pts),collarmat,bone=None,sides=6,flatten=.55)
# Understated coat buttons; offset from the open centre seam.
for z in [1.228,1.127,1.041]:ball('ESE_Coat_Button',(.030,front_y(.030,z,.004),z),(.0048,.0018,.0048),collarmat,'Spine1' if z>1.18 else 'Spine',16,8)
# Pendant chain lies on the neckline; a faceted amethyst is the signature detail.
chain=bezier([(-.040,-.067,1.488),(-.032,-.114,1.432),(0,-.154,1.397),(.032,-.114,1.432),(.040,-.067,1.488)],58)
tube('ESE_Pendant_Chain',chain,[.00075]*len(chain),gold,bone='Spine2',sides=6)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(0,-.157,1.389));gem=bpy.context.object;gem.name='ESE_Amethyst_Pendant';gem.scale=(.008,.004,.011);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);gem.data.materials.append(purple);bind(gem,'Spine2')
for s in [-1,1]:ball('ESE_Amethyst_Earring',(s*.082,-.018,1.608),(.0038,.0028,.0052),purple)
# Small infinity emblem, following the left chest instead of a billboard logo.
pts=[]
for i in range(65):
 a=i/64*math.tau;x=.128+.013*math.cos(a);z=1.366+.006*math.sin(2*a);pts.append((x,front_y(x,z,.007),z))
tube('ESE_Infinity_Emblem',pts,[.00105]*len(pts),purple,bone='Spine2',sides=6)
# Join new meshes by material to keep the web character inexpensive to draw.
groups={}
for o in list(scene.objects):
 if o.type=='MESH' and o.name.startswith('ESE_') and not o.data.shape_keys:
  groups.setdefault(o.data.materials[0].name,[]).append(o)
for material,objects in groups.items():
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]
 if len(objects)>1:bpy.ops.object.join()
 bpy.context.object.name=material
light=blonde_light;dark=blonde_dark
# Small inset shoulder pieces close the junction without a padded silhouette.
for side,name in [(1,'Left'),(-1,'Right')]:
 ball('ESE_Shoulder_Undercap',(side*.166,-.018,1.435),(.035,.061,.025),ivory,'Spine2',24,16)
# Broaden the original gathered cap as one continuous volume, keeping its curved
# hairline. The bun stays separate, while front locks trace a gentle side part.
for o in scene.objects:
 if o.type=='MESH' and o.name in ['ESE_Honey_Blonde','ESE_Champagne_Blonde','ESE_Blonde_Shadow']:
  for v in o.data.vertices:
   p=o.matrix_world@v.co
   if 1.718<p.z<1.794:
    fullness=math.sin(math.pi*(p.z-1.718)/.076)**.7
    p.x*=1+.22*fullness
    if p.y<-.03:p.y-=.006*fullness
    v.co=o.matrix_world.inverted()@p
for j in range(16):
 t=j/15
 pts=bezier([(-.027+.016*t,-.143+.008*t,1.713+.011*t),(.007+.031*t,-.140+.015*t,1.750+.014*t),(.047+.022*t,-.104+.027*t,1.780+.004*t),(.058+.012*t,-.035+.02*t,1.781-.005*t),(.034,.032,1.795)],36)
 rs=[.0012+.0045*math.sin(math.pi*k/35)**.7 for k in range(36)]
 tube('ESE_Side_Swept_Lock',pts,rs,light if j%5==0 else blonde,sides=8,flatten=.65)
 for offset in [-.001,.001]:tube('ESE_Swept_Lock_Ridge',[p+Vector((offset,-.001,.0013)) for p in pts],[.0004]*len(pts),light,sides=4)
for j in range(8):
 t=j/7;pts=bezier([(-.031-.035*t,-.141+.023*t,1.714-.015*t),(-.058-.020*t,-.111+.019*t,1.745),(-.07-.008*t,-.050,1.764),(-.043,.036,1.795)],28)
 tube('ESE_Left_Swept_Lock',pts,[.001+.0037*math.sin(math.pi*k/27)**.7 for k in range(28)],blonde if j%3 else light,sides=7,flatten=.6)
# Relax the front expression without including mouth animation in body clips.
for o in scene.objects:
 if o.type=='MESH' and o.data.shape_keys:
  for k in o.data.shape_keys.key_blocks:
   if k.name in ['mouthSmileLeft','mouthSmileRight']:k.value=.27
   elif k.name in ['eyeSquintLeft','eyeSquintRight']:k.value=.06
# Merge additions by material with existing rigidly skinned geometry.
groups={}
for o in list(scene.objects):
 if o.type=='MESH' and o.name.startswith('ESE_') and not o.data.shape_keys:groups.setdefault(o.data.materials[0].name,[]).append(o)
for material,objects in groups.items():
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]
 if len(objects)>1:bpy.ops.object.join()
 bpy.context.object.name=material

# Gentle warmth is baked into the original face texture so glTF and Blender agree.
m=bpy.data.materials['ELOHIM_Warm_Skin'];im=next(n.image for n in m.node_tree.nodes if n.type=='TEX_IMAGE');pixels=np.array(im.pixels[:],dtype=np.float32).reshape((-1,4));pixels[:,:3]*=(.995,.972,.95);im.pixels.foreach_set(pixels.ravel());im.pack()
# The new neckline uses the median original neck texture colour in linear PBR space.
c=np.array((.8666667,.6901961,.5803922))*(.995,.972,.95);linear=np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
bpy.data.materials['ESE_Warm_Neckline'].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*linear,1)

# Every clip has every joint rotation, preventing additive head/gaze accumulation.
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
rig.data.pose_position='POSE';rig.animation_data_create()
def set_direction(name,direction):
 bpy.context.view_layer.update();pb=rig.pose.bones[name];q=(pb.tail-pb.head).rotation_difference(Vector(direction));m=pb.matrix.copy();m=Matrix.Translation(pb.head)@q.to_matrix().to_4x4()@Matrix.Translation(-pb.head)@m;pb.matrix=m;bpy.context.view_layer.update()
def worldrot(name,axis,angle):
 pb=rig.pose.bones[name];return Quaternion(pb.bone.matrix_local.to_quaternion().inverted()@Vector(axis),angle)
clips=[('Idle',120),('Listening',120),('Speaking',120),('Examining',120),('Pointing',120),('ClinicalTransition',100),('Welcome',120),('Empathy',120)]
for name,duration in clips:
 action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
 for f in range(1,duration+2,5):
  f=min(f,duration+1);t=(f-1)/duration;phase=math.sin(t*math.tau);env=math.sin(math.pi*t)**2
  for pb in rig.pose.bones:pb.rotation_quaternion=Quaternion();pb.location=(0,0,0)
  rig.pose.bones['Spine2'].rotation_quaternion=worldrot('Spine2',(1,0,0),.007*phase)
  rig.pose.bones['Head'].rotation_quaternion=worldrot('Head',(0,0,1),.012*phase)
  for s,side in [(-1,'Right'),(1,'Left')]:
   up=Vector((s*.067,-.018,-.25));fore=Vector((s*.015,-.185,-.092))
   if side=='Right':
    if name in ['Speaking','Pointing','Welcome']:
     target_up=Vector((s*.142,-.030,-.192));target_fore=Vector((s*.126,-.09,.180))
     up=up.lerp(target_up,env*(.68 if name=='Speaking' else 1));fore=fore.lerp(target_fore,env)
    if name=='Empathy':up=up.lerp(Vector((s*.046,-.10,-.225)),env);fore=fore.lerp(Vector((-s*.13,-.15,.145)),env)
   if name=='Examining':fore=fore.lerp(Vector((s*.05,-.23,.04)),env*.65)
   set_direction(side+'Arm',up);set_direction(side+'ForeArm',fore)
   if side=='Right' and name=='Welcome':rig.pose.bones[side+'Hand'].rotation_quaternion=worldrot(side+'Hand',(0,1,0),.22*math.sin(t*math.tau*3)*env)
   for finger in ['Index','Middle','Ring','Pinky']:
    for joint in [1,2,3]:
     bend=.08
     if side=='Right' and name=='Pointing' and finger!='Index':bend+=.50*env
     rig.pose.bones[side+'Hand'+finger+str(joint)].rotation_quaternion=Quaternion((1,0,0),bend)
  if name=='Listening':rig.pose.bones['Head'].rotation_quaternion=worldrot('Head',(0,1,0),.05*env)@worldrot('Head',(1,0,0),.04*math.sin(t*math.tau)*env)
  elif name=='Empathy':rig.pose.bones['Head'].rotation_quaternion=worldrot('Head',(0,1,0),.055*env)@worldrot('Head',(1,0,0),.045*env)
  elif name=='Examining':rig.pose.bones['Head'].rotation_quaternion=worldrot('Head',(1,0,0),.09*env)@worldrot('Head',(0,0,1),.04*phase)
  elif name=='Speaking':rig.pose.bones['Head'].rotation_quaternion=worldrot('Head',(1,0,0),.025*math.sin(t*math.tau*2))
  rig.pose.bones['Hips'].location=(0,.0012*phase,0)
  for pb in rig.pose.bones:pb.keyframe_insert('rotation_quaternion',frame=f,group=pb.name)
  rig.pose.bones['Hips'].keyframe_insert('location',frame=f,group='Hips')
rig.animation_data.action=bpy.data.actions['Idle'];scene.frame_set(1)
for o in scene.objects:
 if o.type=='MESH' and o.data.shape_keys:
  for k in o.data.shape_keys.key_blocks:k.value=.27 if k.name in ['mouthSmileLeft','mouthSmileRight'] else .06 if k.name in ['eyeSquintLeft','eyeSquintRight'] else 0
rig['character']='Ese';rig['portalY']=1.025;rig['defaultMode']='signature clinical';rig['license']='Base humanoid CC0 TalkingHead/MPFB. Ese custom hair, clothing, jewelry and animation authored for this project.'
# Real geometry studio preview, identical PBR materials to exported glTF.
scene.world=bpy.data.worlds.new('Ese_Studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.018,.026,.043,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.32

def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc,power,size,col in [('Key',(-1.1,-2.0,2.7),110,1.4,(1,.87,.74)),('Fill',(1.0,-1.6,1.8),55,1.4,(.77,.86,1)),('HairRim',(.2,.8,2.1),85,1.0,(.71,.66,1))]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=col;aim(o,(0,-.05,1.5))
bpy.ops.object.camera_add(location=(.18,-3.5,1.65));cam=bpy.context.object;cam.name='Ese_Portrait_Camera';aim(cam,(0,-.035,1.46));cam.data.type='ORTHO';cam.data.ortho_scale=1.22;scene.camera=cam
scene.render.fps=30;scene.render.engine='CYCLES';scene.cycles.samples=args.samples;scene.cycles.use_denoising=True;scene.render.resolution_x=960;scene.render.resolution_y=1040;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False;scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'

if args.fast:
 scene.render.engine='CYCLES';scene.cycles.samples=8;scene.render.resolution_percentage=65
scene.render.filepath=str(OUT/'ese-preview.png')
for im in bpy.data.images:
 if im.size[0]:im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'ese.blend'),compress=True)
bpy.ops.render.render(write_still=True)
rig.animation_data.action=bpy.data.actions['Welcome'];scene.frame_set(61);scene.render.filepath=str(OUT/'ese-welcome-preview.png');bpy.ops.render.render(write_still=True)
rig.animation_data.action=bpy.data.actions['Idle'];scene.frame_set(1)
if not args.preview_only:
 for o in scene.objects:o.select_set(o.type in {'MESH','ARMATURE'})
 bpy.context.view_layer.objects.active=rig
 bpy.ops.export_scene.gltf(filepath=str(OUT/'ese.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_morph=True,export_morph_normal=True,export_morph_tangent=False,export_image_format='JPEG',export_image_quality=88,export_extras=True,export_yup=True,export_force_sampling=True,export_frame_range=False,export_anim_single_armature=True)
 relaxed_default(OUT/'ese.glb');print(compact_morph_normals(OUT/'ese.glb'))
 print('ESE_BUILD_COMPLETE')
