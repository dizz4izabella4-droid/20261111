# voice-align — 切り分け依頼を音節ラベルにする（AI 側）

`tools/voice.html` が書き出した `*.cutreq.zip` を受け取り、`labels.json` を返すスクリプト。
設計と精度は `../voice-DESIGN.md` の §4・§5。

## Claude Code での手順（ユーザーから cutreq.zip を渡されたとき）

```sh
cd <repo>
python3 -m venv .venv-voice && .venv-voice/bin/pip install numpy     # 初回のみ
tools/voice-align/setup_julius.sh                                    # 初回のみ（git・cc・make）
.venv-voice/bin/python tools/voice-align/align.py ~/Downloads/xxx.cutreq.zip -o ~/Downloads/labels.json
```

1. 出力の各行（録音ごとのラベル数・方式・低信頼の数・警告）をユーザーに伝える。
2. `labels.json` をアプリの「切り分け」画面の「labels.json を読み込む」で取り込んでもらう。
3. 低信頼（橙色）のラベルを聞いて直してもらう。

`--method signal` で Julius を使わずに信号解析だけ、`--no-trim` で端の無音詰めをしない。

## 精度の確かめ方（macOS）

```sh
.venv-voice/bin/python tools/voice-align/tests/make_synthetic.py /tmp/syn
for v in kyoko-clean kyoko-tight flo-tight kyoko-singles; do
  .venv-voice/bin/python tools/voice-align/align.py /tmp/syn/$v -o /tmp/syn/$v.json
  .venv-voice/bin/python tools/voice-align/tests/evaluate.py /tmp/syn/$v /tmp/syn/$v.json
done
.venv-voice/bin/python tools/voice-align/tests/check_sync.py
```

## 中身

- `align.py` 本体（Julius 強制アラインメント → だめなら信号解析）
- `kana.py` 音節の一覧・分解・音素
- `setup_julius.sh` Julius と segmentation-kit を `.build/` に用意（固定コミット）
- `sentences.json` 例文の正本
- `tests/` 合成音声での精度測定、`voice.html` との一致確認

Julius: <https://github.com/julius-speech/julius>（BSD 系ライセンス）、モデル: <https://github.com/julius-speech/segmentation-kit>。どちらもリポジトリには入れていない。
