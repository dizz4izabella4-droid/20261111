import json,numpy as np,librosa,sys
y,sr=librosa.load(sys.argv[1],sr=22050,mono=True)
hop=256
yh,yp=librosa.effects.hpss(y)
penv=librosa.onset.onset_strength(y=yp,sr=sr,hop_length=hop)
fenv=librosa.onset.onset_strength(y=y,sr=sr,hop_length=hop)
cent=librosa.feature.spectral_centroid(y=y,sr=sr,hop_length=hop)[0]
rms=librosa.feature.rms(y=y,hop_length=hop)[0]
ft=librosa.frames_to_time(np.arange(len(penv)),sr=sr,hop_length=hop)
beats=np.array(json.load(open('grid.json'))['beats'])
penv/=np.percentile(penv,99); fenv/=np.percentile(fenv,99)
slots=[]
for i in range(len(beats)-1):
  for j in range(4):
    t=beats[i]+(beats[i+1]-beats[i])*j/4
    if t<1.0 or t>179.2: continue
    m=(ft>t-0.03)&(ft<t+0.03)
    if not m.any(): continue
    p=penv[m].max(); f=fenv[m].max()
    fi=np.flatnonzero(m)[np.argmax(penv[m])]
    # local loudness context
    lm=(ft>t-4)&(ft<t+4)
    loc=np.percentile(penv[lm],90)+1e-6
    slots.append(dict(t=float(t),beat=i,sub=j,p=float(p),f=float(f),rel=float(p/loc),c=float(cent[fi]),e=float(rms[np.flatnonzero(lm)].mean())))
print(len(slots))
S=np.array([s['p']*0.7+s['f']*0.3 for s in slots])
def pick(level):
  tgt={'easy':175,'normal':340,'hard':600}[level]
  mg={'easy':0.45,'normal':0.24,'hard':0.124}[level]
  allowed={'easy':(0,2),'normal':(0,1,2,3),'hard':(0,1,2,3)}[level]
  wsub={'easy':{0:1.25,2:0.9},'normal':{0:1.2,2:1.0,1:0.7,3:0.75},'hard':{0:1.15,2:1.0,1:0.9,3:0.9}}[level]
  cand=[dict(s,sc=float(sc),w=float(sc*(0.5+0.5*min(s['rel'],1.2))*wsub[s['sub']])) for s,sc in zip(slots,S) if s['sub'] in allowed]
  order=sorted(range(len(cand)),key=lambda i:-cand[i]['w'])
  taken=[];tt=[]
  import bisect
  for i in order:
    if len(taken)>=tgt: break
    t=cand[i]['t']; k=bisect.bisect(tt,t)
    if k>0 and t-tt[k-1]<mg-1e-3: continue
    if k<len(tt) and tt[k]-t<mg-1e-3: continue
    tt.insert(k,t); taken.insert(k,cand[i])
  res=taken
  # lanes: centroid relative to local median
  cs=np.array([n['c'] for n in res]); ts=np.array([n['t'] for n in res])
  notes=[];prev=None;run=0
  for k,n in enumerate(res):
    m=np.abs(ts-n['t'])<6
    med=np.median(cs[m])
    lane=0 if n['c']<med else 1
    if prev is not None:
      gap=n['t']-prev['t']
      if gap<0.2 and lane==prev['lane']: lane=1-lane
      if lane==prev['lane']: run+=1
      else: run=0
      if run>=3 and gap<0.3: lane=1-lane; run=0
    d={'t':round(n['t'],4),'l':lane}
    # doubles on strongest accents
    thr=None
    if thr and n['sub']==0 and n['rel']>thr and n['sc']>0.75 and (not notes or n['t']-notes[-1]['t']>0.3) :
      d['l']=2
    notes.append(d); prev=dict(d,lane=d['l'] if d['l']<2 else lane)
  nd={'easy':0,'normal':22,'hard':44}[level]
  idx=sorted([k for k,n in enumerate(res) if n['sub']==0],key=lambda k:-res[k]['sc'])
  c=0
  for k in idx:
    if c>=nd: break
    gp=res[k]['t']-res[k-1]['t'] if k>0 else 9
    gn=res[k+1]['t']-res[k]['t'] if k+1<len(res) else 9
    if gp>0.3 and gn>0.3 and not any(notes[j]['l']==2 and abs(notes[j]['t']-notes[k]['t'])<2 for j in range(max(0,k-8),min(len(notes),k+8))):
      notes[k]['l']=2;c+=1
  return notes
charts={k:pick(k) for k in ['easy','normal','hard']}
for k,v in charts.items():
  dbl=sum(1 for n in v if n['l']==2)
  print(k,len(v),'nps %.2f'%(len(v)/178),'doubles',dbl)
# section map from energy for visuals: per beat intensity 0..1
bi=[]
for i in range(len(beats)):
  m=(ft>beats[i]-0.25)&(ft<beats[i]+0.25)
  bi.append(float(rms[m].mean()) if m.any() else 0)
bi=np.array(bi); bi=np.convolve(np.pad(bi,8,mode='edge'),np.ones(17)/17,'valid'); bi=(bi-bi.min())/(bi.max()-bi.min())
json.dump({'beats':[round(b,4) for b in beats.tolist()],'energy':[round(x,3) for x in bi.tolist()],'charts':charts},open('chart.json','w'),separators=(',',':'))
