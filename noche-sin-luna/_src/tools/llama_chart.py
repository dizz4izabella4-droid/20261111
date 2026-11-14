# 2曲目「Llama pura de amor」の譜面（chart2.json）を、ハンドオフ資料のCSVから作る。
# 使い方: ffmpeg -i Llama_pura_de_amor.mp3 -ac 1 -ar 22050 llama.wav → python3 tools/llama_chart.py llama.wav（_src で実行。numpy / scipy が必要）
# ・ノーツ：GOLPE_BAJO→左レーン / GOLPE_ALTO→右レーン（ゴルペ2音が基本）。同時刻に左右両方あれば同時押し(l=2)。
#   PALMAS（手拍子）はレーンに入れず、時刻だけ palmas に残す（おまけ。ゲームでは未使用）。
# ・拍：beatgrid.csv の実測の拍（テンポの揺れをそのまま使う）。小節頭が配列の 3,7,11… 番目になるよう、頭に4拍ぶん足す（曲1と同じ並び）。
# ・盛り上がり(energy)：拍ごとの音量を曲1の分布に順位でそろえる（見た目の強弱が曲1と同じ幅になる）。
import csv, json, sys, collections
import numpy as np, scipy.io.wavfile as wf
D = 'songs/llama/'
sr, x = wf.read(sys.argv[1]); x = x.astype(np.float32) / 32768; dur = len(x) / sr

# --- 拍
pulse = [float(r['time_sec']) for r in csv.DictReader(open(D + 'beatgrid.csv'))]
iv = float(np.median(np.diff(pulse)))
beats = [round(pulse[0] - iv * k, 4) for k in range(4, 0, -1)] + pulse
while beats[-1] < dur + 0.3: beats.append(round(beats[-1] + iv, 4))
assert ((beats.index(1.858) - 3) % 4) == 0          # 1小節目の頭（1.858s）が 3,7,11… 番目

# --- 盛り上がり
w = int(0.2 * sr)
def seg_rms(b):
    s = x[max(0, int(b * sr) - w):int(b * sr) + w]
    return float(np.sqrt(np.mean(s ** 2) + 1e-12)) if b > 0 and len(s) else 1e-6   # 曲の外（頭・末尾）は無音あつかい
rms = np.array([seg_rms(b) for b in beats])
le = np.convolve(np.log(rms + 1e-6), np.ones(3) / 3, 'same')
ref = np.sort(np.array(json.load(open('chart.json'))['energy']))
rank = np.argsort(np.argsort(le)) / (len(le) - 1)
energy = [round(float(v), 3) for v in np.interp(rank, np.linspace(0, 1, len(ref)), ref)]

# --- ノーツ
g = collections.OrderedDict()
for r in csv.DictReader(open(D + 'chart_notes.csv')):
    t = round(float(r['time_sec']), 4); g.setdefault(t, set()).add(r['lane'])
notes = []; palmas = []
for t, lanes in g.items():
    if 'PALMAS' in lanes: palmas.append(t)
    right = 'GOLPE_ALTO' in lanes; left = 'GOLPE_BAJO' in lanes
    if not (left or right): continue                      # 手拍子だけの時刻はノーツにしない
    notes.append({'t': t, 'l': 2 if (left and right) else 1 if right else 0, 'c': 'g' if right else 'b'})
assert notes[-1]['t'] <= 118.0
json.dump({'beats': beats, 'energy': energy, 'charts': {'normal': notes}, 'palmas': palmas}, open('chart2.json', 'w'), separators=(',', ':'))
print('beats', len(beats), 'notes', len(notes), collections.Counter(n['l'] for n in notes), 'palmas', len(palmas), 'last', notes[-1]['t'])
