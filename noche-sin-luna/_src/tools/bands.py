# 曲を3帯域（低音・ギター・手拍子/高音）に分け、譜面の各ノーツを 低音→左 / 高音→右 / 両方強い→同時 に振り直す。
# 使い方: ffmpeg -i 曲.mp3 -ac 1 -ar 22050 song.wav → python3 tools/bands.py song.wav（chart.json と同じ場所で）→ ana.json の charts を chart.json に、tl を timeline.json に入れる
import numpy as np, json, scipy.io.wavfile as wf, scipy.signal as ss
import sys; sr,x=wf.read(sys.argv[1] if len(sys.argv)>1 else 'song.wav'); x=x.astype(np.float32)/32768
chart=json.load(open('chart.json'))
bands={'bajo':(40,220),'guitarra':(220,2200),'palmas':(2200,9000)}
hop=sr//100  # 10ms
env={}
for k,(lo,hi) in bands.items():
    sos=ss.butter(4,[lo,hi],btype='band',fs=sr,output='sos'); y=ss.sosfilt(sos,x)
    e=np.sqrt(np.convolve(y*y,np.ones(hop)/hop,'same'))[::hop]; env[k]=e
n=min(len(v) for v in env.values())
for k in env: env[k]=env[k][:n]
# onset strength = positive diff of log env
ons={}
for k,e in env.items():
    le=np.log(e+1e-5); d=np.maximum(0,np.diff(le,prepend=le[0])); d=np.convolve(d,np.ones(3)/3,'same')
    ons[k]=d/ (np.percentile(d,99)+1e-9)
# per-note component
def at(arr,t,w=4):
    i=int(round(t*100)); return arr[max(0,i-w):i+w+1].max()
out={}
for diff,notes in chart['charts'].items():
    res=[]; cnt={'g':0,'a':0,'d':0}
    for nt in notes:
        t=nt['t']; lo=at(ons['bajo'],t); mi=at(ons['guitarra'],t); hi=at(ons['palmas'],t)
        low=lo; high=max(hi,mi*0.9)
        if diff!='easy' and min(low,high)>0.55 and abs(low-high)<0.25: l=2
        else: l=0 if low>=high else 1
        cnt['gad'[l]]+=1
        res.append({'t':t,'l':l,'c':['bajo','guitarra','palmas'][int(np.argmax([lo,mi,hi]))][0]})
    out[diff]=res; print(diff,len(res),cnt)
# timeline 10fps, normalized per band (log)
tl={}
for k,e in env.items():
    e10=e[:n//10*10].reshape(-1,10).mean(1); le=np.log(e10+1e-5); lo,hi=np.percentile(le,5),np.percentile(le,99.5)
    q=np.clip((le-lo)/(hi-lo),0,1); tl[k]=''.join('0123456789abcdefghijklmnopqrstuvwxyz'[int(v*35)] for v in q)
print({k:len(v) for k,v in tl.items()})
# sections from chart energy per beat (smooth)
beats=np.array(chart['beats']); en=np.array(chart['energy'])
sm=np.convolve(en,np.ones(16)/16,'same')
print(np.round(sm[::16],2), beats[::16].round(0))
json.dump({'charts':out,'tl':tl},open('ana.json','w'))
