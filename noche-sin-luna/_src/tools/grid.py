import json,numpy as np
a=json.load(open('analysis.json'))
ons=np.array(a['pons']);s=np.array(a['ponsStr'])
b=np.array(a['beats'])
# build smoothed beat grid by local onset-phase alignment
P=0.49964
# start from global fit then local correction
k=np.arange(-1, int((182.7-0.147)/P)+2)
grid=0.147+k*P
corr=[]
for i,t in enumerate(grid):
  m=(ons>t-2.5)&(ons<t+2.5)
  if m.sum()<4: corr.append(np.nan);continue
  g=P/4; ph=(ons[m]-t)/g; d=(ph-np.round(ph))*g
  # robust weighted median-ish
  w=s[m]*np.exp(-(d/0.02)**2)
  corr.append(np.sum(w*d)/np.sum(w) if w.sum()>0 else 0)
corr=np.array(corr)
# iterate twice
for it in range(3):
  nanm=np.isnan(corr); corr[nanm]=np.interp(np.flatnonzero(nanm),np.flatnonzero(~nanm),corr[~nanm])
  sm=np.convolve(np.pad(corr,4,mode='edge'),np.ones(9)/9,'valid')
  grid2=grid+sm
  c2=[]
  for t in grid2:
    m=(ons>t-2.5)&(ons<t+2.5)
    if m.sum()<4: c2.append(np.nan);continue
    g=P/4; ph=(ons[m]-t)/g; d=(ph-np.round(ph))*g
    w=s[m]*np.exp(-(d/0.015)**2)
    c2.append(np.sum(w*d)/np.sum(w) if w.sum()>0 else 0)
  c2=np.array(c2); nanm=np.isnan(c2); c2[nanm]=0
  grid=grid2; corr=c2
beats=grid
# 16th grid
six=[]
for i in range(len(beats)-1):
  for j in range(4): six.append(beats[i]+(beats[i+1]-beats[i])*j/4)
six=np.array(six)
idx=np.searchsorted(six,ons); idx=np.clip(idx,1,len(six)-1)
near=np.where(np.abs(six[idx]-ons)<np.abs(six[idx-1]-ons),idx,idx-1)
err=(ons-six[near])*1000
print('resid ms median abs',np.median(np.abs(err)),'wmean abs',np.average(np.abs(err),weights=s))
for w in range(0,183,15):
  m=(ons>=w)&(ons<w+15); print(w,'%.1f'%np.median(err[m]),end=' | ')
json.dump({'beats':beats.tolist()},open('grid.json','w'))
print('\nbeats',len(beats),beats[:3],beats[-3:])
