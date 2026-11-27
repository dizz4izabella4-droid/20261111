"""Trace the closed right-hand reference locally.
Usage: python3 scripts/trace-hand-reference.py reference.png [output.ts]
The second, open-hand image informs the manually estimated MCP pivots.
"""
from PIL import Image
from pathlib import Path
import json,math,sys
im=Image.open(sys.argv[1]).convert('RGB')
def dark(x,y):
 x,y=round(x),round(y)
 return 0<=x<im.width and 0<=y<im.height and max(im.getpixel((x,y)))<100
profiles=[]
for tip,base,lo,hi in [(52,365,620,707),(9,365,708,795),(55,365,793,874),(180,380,875,950)]:
 rows=sorted(set([base,tip]+list(range(tip+2,base,12))+[tip+1,tip+3,tip+6,tip+10]),reverse=True)
 profile=[]
 for y in rows:
  xs=[x for x in range(lo,hi+1) if dark(x,y)]
  if xs:
   center=min(xs,key=lambda x:abs(x-(lo+hi)/2))
   left=right=center
   while left>lo and dark(left-1,y):left-=1
   while right<hi and dark(right+1,y):right+=1
   xs=list(range(left,right+1))
  if xs:profile.append([(base-y)/(base-tip),(775-(min(xs)+max(xs))/2)/350,(775-y)/766,(max(xs)-min(xs)+1)/700])
 # Pointed samples at the actual rounded apex; the dense samples retain its curvature.
 profile[-1][0]=1; profile[-1][3]=0
 profiles.append(profile)
thumb_joints=[[644,609],[563,493],[540,428],[493,369]]
seg=[math.dist(a,b) for a,b in zip(thumb_joints,thumb_joints[1:])];total=sum(seg)
# A single transverse direction gives a consistent ring plane, including the curved tip.
dx=thumb_joints[-1][0]-thumb_joints[0][0];dy=thumb_joints[-1][1]-thumb_joints[0][1];mag=math.hypot(dx,dy);nx,ny=-dy/mag,dx/mag
thumb=[]
for j in range(101):
 t=j/100;d=t*total;k=0
 while k<2 and d>seg[k]:d-=seg[k];k+=1
 q=d/seg[k];a,b=thumb_joints[k:k+2];x=a[0]+q*(b[0]-a[0]);y=a[1]+q*(b[1]-a[1]);neg=pos=0
 if dark(x,y):
  while neg<150 and dark(x-(neg+.5)*nx,y-(neg+.5)*ny):neg+=.5
  while pos<150 and dark(x+(pos+.5)*nx,y+(pos+.5)*ny):pos+=.5
 offset=(pos-neg)/2;x+=offset*nx;y+=offset*ny
 thumb.append([t,(775-x)/350,(775-y)/766,(pos+neg)/700])
thumb[-1][3]=0
out='''// Contour samples traced locally from Unknown-4.png (right hand).
// Coordinates: wrist (775,775), middle apex y=9, palm width 350 pixels.
// The image stays local; only normalized geometric measurements are used at runtime.
import { Pchip } from './interp';
export const REFERENCE_FINGERS = '''+json.dumps(profiles,separators=(',',':'))+''' as const;
export const REFERENCE_THUMB = '''+json.dumps(thumb,separators=(',',':'))+''' as const;
export const REFERENCE_ROOTS = [[664,430],[753,420],[834,430],[912,455]] as const;
export const REFERENCE_THUMB_JOINTS = '''+json.dumps(thumb_joints)+''' as const;
export const referenceX = (x: number) => (775 - x) / 350;
export const referenceY = (y: number) => (775 - y) / 766;
const curves = [REFERENCE_THUMB, ...REFERENCE_FINGERS].map(samples => ({
  x: new Pchip(samples.map(p => p[0]), samples.map(p => p[1])),
  y: new Pchip(samples.map(p => p[0]), samples.map(p => p[2])),
  r: new Pchip(samples.map(p => p[0]), samples.map(p => p[3])),
}));
export function referenceFinger(f: number, t: number) {
  const c = curves[f]; return { x: c.x.eval(t), y: c.y.eval(t), radius: Math.max(0,c.r.eval(t)) };
}
// Main palm edge; the separate thumb branch supplies the outline above its web.
const palmY = [385,400,450,500,525,550,575,600,625,650,675,700,725,750,775];
const palmLeft = [624,620,613,603,603,600,595,590,588,595,606,617,632,644,649];
const palmRight = [947,948,955,958,957,955,952,948,942,934,923,913,901,896,894];
const left = new Pchip(palmY, palmLeft), right = new Pchip(palmY, palmRight);
export function referencePalm(y: number) {
  const pixelY = 775 - y * 766;
  return { lo: referenceX(right.eval(pixelY)), hi: referenceX(left.eval(pixelY)) };
}
export const REFERENCE_LANE_X = [947,874,796,709,624].map(referenceX);
export const REFERENCE_WEB_Y = [385,389,370,373,385].map(referenceY);
'''
open(sys.argv[2] if len(sys.argv)>2 else Path(__file__).resolve().parents[1]/'src/model/handReference.ts','w').write(out)
