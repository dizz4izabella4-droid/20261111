import librosa, numpy as np, json, sys
y, sr = librosa.load(sys.argv[1], sr=22050, mono=True)
dur = len(y)/sr
hop=256
oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
tempo, beats = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=hop, units='time')
print('dur',dur,'tempo',tempo, 'nbeats',len(beats))
ons = librosa.onset.onset_detect(onset_envelope=oenv, sr=sr, hop_length=hop, units='time', backtrack=False)
print('onsets',len(ons))
# percussive
yh, yp = librosa.effects.hpss(y)
penv = librosa.onset.onset_strength(y=yp, sr=sr, hop_length=hop)
pons = librosa.onset.onset_detect(onset_envelope=penv, sr=sr, hop_length=hop, units='time')
print('perc onsets',len(pons))
rms = librosa.feature.rms(y=y, hop_length=hop)[0]
ft = librosa.frames_to_time(np.arange(len(oenv)), sr=sr, hop_length=hop)
# strengths at onsets
def strength(ts, env):
    idx = librosa.time_to_frames(ts, sr=sr, hop_length=hop)
    idx = np.clip(idx,0,len(env)-1)
    return env[idx]
bt = np.diff(beats)
print('beat interval median', np.median(bt), 'std', np.std(bt))
print('first beats', beats[:12])
print('last beats', beats[-5:])
# energy per 5s
seg = [float(np.mean(rms[(ft>=s)&(ft<s+5)])) for s in np.arange(0,dur,5)]
print('rms5', [round(x,3) for x in seg])
json.dump({'dur':dur,'tempo':float(np.atleast_1d(tempo)[0]),'beats':beats.tolist(),
 'onsets':ons.tolist(),'onsetStr':strength(ons,oenv).tolist(),
 'pons':pons.tolist(),'ponsStr':strength(pons,penv).tolist(),
 'rms':rms[::4].tolist(),'rmsHop':hop*4/sr}, open('analysis.json','w'))
