import fs from 'fs';
export const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
export const len=a=>Math.hypot(a[0],a[1],a[2]), norm=a=>mul(a,1/(len(a)||1)), lerp=(a,b,t)=>a+(b-a)*t, vlerp=(a,b,t)=>add(a,mul(sub(b,a),t));
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const clamp=(x,a,b)=>x<a?a:x>b?b:x, smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
// ---------- GLB ----------
const CT={5126:Float32Array,5123:Uint16Array,5125:Uint32Array,5121:Uint8Array}, NC={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
export function readGLB(file){const d=fs.readFileSync(file);let o=12,js,bin;while(o<d.length){const n=d.readUInt32LE(o),t=d.readUInt32LE(o+4),c=d.subarray(o+8,o+8+n);o+=8+n;if(t===0x4E4F534A)js=JSON.parse(c.toString('utf8'));else bin=Buffer.from(c);}return{js,bin};}
export function accessor(g,i){const a=g.js.accessors[i],v=g.js.bufferViews[a.bufferView],T=CT[a.componentType],n=NC[a.type],sz=T.BYTES_PER_ELEMENT,stride=v.byteStride||n*sz,off=(v.byteOffset||0)+(a.byteOffset||0),out=new T(a.count*n);
  for(let k=0;k<a.count;k++){const b=g.bin.subarray(off+k*stride,off+k*stride+n*sz);new Uint8Array(out.buffer,k*n*sz,n*sz).set(b);}return out;}
export function writeGLB(file,js,bin){let j=Buffer.from(JSON.stringify(js),'utf8');j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,0x20)]);const b=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
  const h=Buffer.alloc(12);h.write('glTF',0);h.writeUInt32LE(2,4);h.writeUInt32LE(12+8+j.length+8+b.length,8);const c=(n,t)=>{const x=Buffer.alloc(8);x.writeUInt32LE(n,0);x.writeUInt32LE(t,4);return x;};
  fs.writeFileSync(file,Buffer.concat([h,c(j.length,0x4E4F534A),j,c(b.length,0x004E4942),b]));}
// ---------- distance field ----------
function triDist2(px,py,pz,a,b,c){
  const abx=b[0]-a[0],aby=b[1]-a[1],abz=b[2]-a[2],acx=c[0]-a[0],acy=c[1]-a[1],acz=c[2]-a[2],apx=px-a[0],apy=py-a[1],apz=pz-a[2];
  const d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;let u=0,v=0;
  if(d1<=0&&d2<=0){}else{const bpx=px-b[0],bpy=py-b[1],bpz=pz-b[2],d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
    if(d3>=0&&d4<=d3){u=1;}else{const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){u=d1/(d1-d3);}else{const cpx=px-c[0],cpy=py-c[1],cpz=pz-c[2],d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
      if(d6>=0&&d5<=d6){v=1;}else{const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){v=d2/(d2-d6);}else{const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0){v=(d4-d3)/((d4-d3)+(d5-d6));u=1-v;}else{const den=1/(va+vb+vc);u=vb*den;v=vc*den;}}}}}}
  const dx=apx-abx*u-acx*v,dy=apy-aby*u-acy*v,dz=apz-abz*u-acz*v;return dx*dx+dy*dy+dz*dz;}
export class Field{
  constructor(min,max,h,band){this.min=min;this.h=h;this.band=band;this.n=min.map((m,i)=>Math.ceil((max[i]-m)/h)+1);const[a,b,c]=this.n;this.d=new Float32Array(a*b*c).fill(band);}
  clone(){const f=Object.create(Field.prototype);Object.assign(f,this);f.d=this.d.slice();return f;}
  splat(tris,thick){const{min,h,n,d}=this,reach=this.band;for(const[a,b,c]of tris){const lo=[0,1,2].map(k=>Math.max(0,Math.floor((Math.min(a[k],b[k],c[k])-reach-min[k])/h))),hi=[0,1,2].map(k=>Math.min(n[k]-1,Math.ceil((Math.max(a[k],b[k],c[k])+reach-min[k])/h)));
    for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){const i=(z*n[1]+y)*n[0]+x,cur=d[i]+thick;if(cur<=0)continue;const q=triDist2(min[0]+x*h,min[1]+y*h,min[2]+z*h,a,b,c);if(q<cur*cur)d[i]=Math.sqrt(q)-thick;}}}
  addSolid(tris){ // watertight mesh: unsigned narrow band, sign by ray parity along z
    this.splat(tris,0);const{min,h,n,d}=this,cols=new Map();
    for(const[a,b,c]of tris){const x0=Math.ceil((Math.min(a[0],b[0],c[0])-min[0])/h),x1=Math.floor((Math.max(a[0],b[0],c[0])-min[0])/h),y0=Math.ceil((Math.min(a[1],b[1],c[1])-min[1])/h),y1=Math.floor((Math.max(a[1],b[1],c[1])-min[1])/h);
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const px=min[0]+x*h+1.3e-6,py=min[1]+y*h+2.7e-6,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-14)continue;
        const u=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/den,v=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/den,w=1-u-v;if(u<0||v<0||w<0)continue;const k=y*n[0]+x;if(!cols.has(k))cols.set(k,[]);cols.get(k).push(u*a[2]+v*b[2]+w*c[2]);}}
    let odd=0;for(const[k,zs]of cols){zs.sort((p,q)=>p-q);if(zs.length%2)odd++;const x=k%n[0],y=(k-x)/n[0];for(let s=0;s+1<zs.length;s+=2)for(let z=Math.ceil((zs[s]-min[2])/h);z<=Math.floor((zs[s+1]-min[2])/h);z++){const i=(z*n[1]+y)*n[0]+x;d[i]=-Math.abs(d[i]);}}
    return{columns:cols.size,odd};}
  at(x,y,z,g){const{min,h,n,d}=this,fx=(x-min[0])/h,fy=(y-min[1])/h,fz=(z-min[2])/h;if(!(fx>=0&&fy>=0&&fz>=0&&fx<n[0]-1&&fy<n[1]-1&&fz<n[2]-1)){if(g){g[0]=g[1]=g[2]=0;}return this.band;}
    const i=fx|0,j=fy|0,k=fz|0,u=fx-i,v=fy-j,w=fz-k,o=(k*n[1]+j)*n[0]+i,X=1,Y=n[0],Z=n[0]*n[1];
    const a=d[o],b=d[o+X],c=d[o+Y],e=d[o+X+Y],f=d[o+Z],p=d[o+X+Z],q=d[o+Y+Z],r=d[o+X+Y+Z];
    const ab=a+(b-a)*u,ce=c+(e-c)*u,fp=f+(p-f)*u,qr=q+(r-q)*u,l=ab+(ce-ab)*v,m=fp+(qr-fp)*v;
    if(g){g[0]=(((b-a)*(1-v)+(e-c)*v)*(1-w)+((p-f)*(1-v)+(r-q)*v)*w)/h;g[1]=((ce-ab)*(1-w)+(qr-fp)*w)/h;g[2]=(m-l)/h;}
    return l+(m-l)*w;}
}
// ---------- cloth on a grid (XPBD) ----------
export function simulate(field,gr,o){ // gr: {nu,nv,closed,pos[j][i],h[j][i],v[j][i],pinned(j,i)}
  const{nu,nv,closed}=gr,n=nu*nv,id=(i,j)=>j*nu+((i%nu)+nu)%nu,x=new Float64Array(n*3),w=new Float64Array(n),C=[];
  const mass=(o.mass||0.35),mw=n/mass;
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){x.set(gr.pos[j][i],id(i,j)*3);w[id(i,j)]=gr.pinned(j,i)?0:mw;}
  const col=i=>closed||i<nu, H=(j,i)=>gr.h[j][((i%nu)+nu)%nu];
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const r=closed||i+1<nu;
    if(r)C.push([id(i,j),id(i+1,j),H(j,i),o.stretch]);
    if(j+1<nv)C.push([id(i,j),id(i,j+1),gr.v[j][i],o.stretch]);
    if(r&&j+1<nv){const dg=Math.hypot((H(j,i)+H(j+1,i))/2,(gr.v[j][i]+gr.v[j][(i+1)%nu])/2);C.push([id(i,j),id(i+1,j+1),dg,o.shear]);C.push([id(i+1,j),id(i,j+1),dg,o.shear]);}
    if(closed||i+2<nu)C.push([id(i,j),id(i+2,j),H(j,i)+H(j,i+1),o.bend]);
    if(j+2<nv)C.push([id(i,j),id(i,j+2),gr.v[j][i]+gr.v[j+1][i],o.bend]);}
  const m=C.length,A=new Int32Array(m),B=new Int32Array(m),R=new Float64Array(m),AL=new Float64Array(m);
  C.forEach(([a,b,r,al],e)=>{A[e]=a*3;B[e]=b*3;R[e]=r;AL[e]=al;});
  const prev=x.slice(),sub=o.sub||24,dt=1/60/sub,g=[0,0,0],lam=new Float64Array(m),margin=o.margin||0.006,vmax=(o.vmax||1.0)*dt;
  const frames=o.frames||200;
  for(let f=0;f<frames;f++)for(let s=0;s<sub;s++){
    const damp=1-(f<frames*0.7?o.damp||3:14)*dt;
    for(let v=0;v<n;v++){if(!w[v])continue;let vx=(x[v*3]-prev[v*3])*damp,vy=(x[v*3+1]-prev[v*3+1])*damp-9.8*dt*dt,vz=(x[v*3+2]-prev[v*3+2])*damp;const sp=Math.hypot(vx,vy,vz);if(sp>vmax){const k=vmax/sp;vx*=k;vy*=k;vz*=k;}
      prev[v*3]=x[v*3];prev[v*3+1]=x[v*3+1];prev[v*3+2]=x[v*3+2];x[v*3]+=vx;x[v*3+1]+=vy;x[v*3+2]+=vz;}
    lam.fill(0);
    for(let it=0;it<2;it++)for(let e=0;e<m;e++){const a=A[e],b=B[e],wa=w[a/3],wb=w[b/3];if(wa+wb===0)continue;const dx=x[a]-x[b],dy=x[a+1]-x[b+1],dz=x[a+2]-x[b+2],L=Math.sqrt(dx*dx+dy*dy+dz*dz)||1e-9,al=AL[e]/(dt*dt);
      const dl=(-(L-R[e])-al*lam[e])/(wa+wb+al);lam[e]+=dl;const k=dl/L;x[a]+=dx*k*wa;x[a+1]+=dy*k*wa;x[a+2]+=dz*k*wa;x[b]-=dx*k*wb;x[b+1]-=dy*k*wb;x[b+2]-=dz*k*wb;}
    for(let v=0;v<n;v++){if(!w[v])continue;const p=v*3,d=field.at(x[p],x[p+1],x[p+2],g)-margin;
      if(d<0){const L=Math.hypot(g[0],g[1],g[2]);if(L>1e-6){const k=-d/L;x[p]+=g[0]*k;x[p+1]+=g[1]*k;x[p+2]+=g[2]*k;}prev[p]+=(x[p]-prev[p])*0.6;prev[p+1]+=(x[p+1]-prev[p+1])*0.6;prev[p+2]+=(x[p+2]-prev[p+2])*0.6;}
      if(x[p+1]<0.008){x[p+1]=0.008;prev[p]+=(x[p]-prev[p])*0.6;prev[p+2]+=(x[p+2]-prev[p+2])*0.6;}}
  }
  let inside=0,moved=0,st=[];for(let v=0;v<n;v++){const p=v*3;if(w[v]&&field.at(x[p],x[p+1],x[p+2])<0)inside++;if(w[v])moved=Math.max(moved,Math.hypot(x[p]-prev[p],x[p+1]-prev[p+1],x[p+2]-prev[p+2])/dt);}
  for(let e=0;e<m;e++)if(AL[e]===o.stretch&&(w[A[e]/3]||w[B[e]/3])){const a=A[e],b=B[e];st.push(Math.hypot(x[a]-x[b],x[a+1]-x[b+1],x[a+2]-x[b+2])/R[e]-1);}st.sort((p,q)=>p-q);
  const pos=[];for(let j=0;j<nv;j++){pos.push([]);for(let i=0;i<nu;i++){const p=id(i,j)*3;pos[j].push([x[p],x[p+1],x[p+2]]);}}
  return{pos,stats:{verts:n,inside,maxSpeed:+moved.toFixed(3),stretchP50:+(100*st[st.length>>1]).toFixed(2),stretchP99:+(100*st[Math.floor(st.length*0.99)]).toFixed(2)}};}
export function gridTris(pos,closed){const nv=pos.length,nu=pos[0].length,t=[];for(let j=0;j+1<nv;j++)for(let i=0;i<(closed?nu:nu-1);i++){const k=(i+1)%nu;t.push([pos[j][i],pos[j+1][i],pos[j+1][k]],[pos[j][i],pos[j+1][k],pos[j][k]]);}return t;}
