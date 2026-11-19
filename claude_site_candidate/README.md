# izのおもちゃ箱 — Claude案（比較用の試作）

公開中のトップ・各部屋・作品には一切手を入れず、このフォルダの中だけで動く比較用の試作です。

| 画面 | 場所 | 役割 |
|---|---|---|
| GALLERY | `index.html` | 初めての人が作品を探して開く。最初はゲームだけを表示（`?cat=all` ですべて）。ハートでお気に入りにすると先頭に並ぶ。端末でしぼり込み、名前で検索、並べ替え。姉妹サイト「あそびば」への目立つカードつき |
| BRAIN | `brain/` | 理念の表現。作品が「枝」として伸びる白い木と、旧BRAINの木窓 |
| ARCHIVE | `archive/` | 制作の記録。公開日（初回コミット日）と最終更新日（日付のみ。時刻は表示しない）、年表・表・カレンダー |

## Macで試す

```sh
git clone https://github.com/dizz4izabella4-droid/20261111.git
cd 20261111
git checkout claude-site-candidate     # このブランチ（またはパッチを当てたもの）
python3 -m http.server 8000
```

ブラウザで <http://localhost:8000/claude_site_candidate/> を開きます。リポジトリの直下で起動するのは、作品へのリンク（`../anzan-tensei/` など）を本物の作品につなぐためです。ファイルをダブルクリックして `file://` で開くと台帳を読み込めないので、その旨の案内が出ます。

iPhoneで試すときは、MacとiPhoneを同じWi‑Fiにつなぎ、`python3 -m http.server 8000 --bind 0.0.0.0` で起動して、iPhoneのSafariで `http://（MacのIPアドレス）:8000/claude_site_candidate/` を開きます。

## ファイル構成

```
claude_site_candidate/
  index.html            GALLERY
  brain/index.html      BRAIN
  archive/index.html    ARCHIVE
  common/site.css       GALLERY・ARCHIVE共通の見た目
  common/site.js        3画面共通：台帳と履歴の読み込み、アイコン、日付表示
  data/works.json       ★作品台帳（人が編集するのはここだけ）
  data/history.json     公開日・更新日の集計結果（自動生成。手で編集しない）
  tools/build_history.py  Git履歴から history.json を作るスクリプト（Python標準ライブラリのみ）
  tools/update-history.yml  自動集計用のGitHub Actions（採用後に .github/workflows/ へコピー）
  migration/            採用時に旧「部屋」URLを作品一覧へ転送するページ（toybox/ lab/ utility/）
  README.md / REPORT.md
```

BRAINの窓の画像・曲は、リポジトリ直下の既存素材（`assets/window_*.webp`、`assets/bgm/tides-under-glass.mp3`）をそのまま参照しています。複製はしていません。

## 作品台帳（data/works.json）の書き方

作品1件は次の形です。日付は書きません。

```json
{
  "id": "anzan-tensei",
  "path": "anzan-tensei/",
  "title": "暗算輪廻",
  "titleEn": "ANZAN",
  "category": "game",
  "summary": "暗算で戦うレトロRPG",
  "devices": ["pc", "mobile"],
  "status": "test",
  "icon": "calc"
}
```

| 項目 | 必須 | 意味 |
|---|---|---|
| `id` | ○ | 英数字の識別名。ふつうはフォルダ名 |
| `path` | ○ | 作品を開くURL。リポジトリ直下からの場所（例 `redline/play/`） |
| `title` | ○ | 日本語の名前（カード・検索・アーカイブに出る） |
| `titleEn` |  | 英語の名前（カードの小さな見出し、BRAINの枝の名前） |
| `category` | ○ | `game`（ゲーム）／`tool`（実用）／`lab`（実験） |
| `summary` |  | 1行の説明 |
| `devices` |  | `["pc","mobile"]`／`["mobile"]`／`["pc"]`。不明なら書かない（しぼり込みで隠れない） |
| `status` |  | `stable`（表示なし）／`test`（試作）／`wip`（未完）／`paused`（開発停止。BRAINでは白抜きの点） |
| `statusNote` |  | 状態の補足（例 `不具合連発`、`開発困難・PC不可`） |
| `icon` |  | アイコン名（`common/site.js` の一覧：calc keyboard phone bird loop glass hige wing flame rosette star blob novel yen scale phones ledger siren thread leaf） |
| `gallery` |  | `false` にすると一覧に出さない（アーカイブには出る）。例：ガラスブレイカー 3D |
| `historyPaths` |  | 日付を集計する場所。省略時は `path` の最初のフォルダ。改名・移動前の場所を足す（下記） |
| `lineageIgnore` |  | 「移動・複製の疑い」を無視してよい理由の記録（下記） |

GALLERYの並び順は日付で決まるので、台帳の中の順番は気にしなくて大丈夫です。

## 新作を公開するとき

1. 作品のフォルダ（例 `new-game/index.html`）を作ってコミット・push（今までどおり）。
2. 台帳に登録する。次のどちらか。
   - `data/works.json` の `works` に1件書き足す。
   - または `python3 claude_site_candidate/tools/build_history.py --add-stubs` を実行すると、台帳にないフォルダを仮登録してくれるので、`title`・`category`・`summary` だけ直す。
3. 日付を集計する：`python3 claude_site_candidate/tools/build_history.py`
4. `data/works.json` と `data/history.json` をコミット・push。GALLERY・ARCHIVE・BRAINの3画面に同時に出ます。

採用後に自動集計（`tools/update-history.yml`）を入れた場合、3 は不要です（pushすると数十秒後に history.json が更新されます）。集計前でも作品は一覧に出て、日付欄は「未集計」になります。

BRAINの木は台帳と日付から自動で描かれるので、作品ごとの配置作業はありません。

`--check` を付けると、何も書き込まずに「未登録の作品フォルダ」「日付を確定できない作品」だけを表示します。

## お気に入り（ハート）

各作品カードの右下のハートを押すと、その作品が「お気に入り」になり、一覧の先頭に並びます（どの並び順でも先頭。種類・端末のしぼり込みの中で先頭）。押した直後は、指の下でカードが動かないよう並びを変えず、画面を開き直したり、しぼり込み・並び順を変えたりしたときに先頭へ移ります。

- 保存先はその端末のブラウザの `localStorage`（キー `izSite.fav`、作品の `id` の配列）だけです。人ごと・端末ごとに別で、通信はしません。作品の保存データとは別のキーです。
- ブラウザの履歴・サイトデータを消すと、お気に入りも消えます。
- 全員分のいいね数を集計したくなったら、`common/site.js` の `favs.toggle` から通知を送る形に足せます（外部サービスが1つ増えます）。

## 作品を移動・改名したとき

フォルダの改名・移動で履歴が途切れないよう、旧い場所を `historyPaths` に足します。実例（台帳に記入済み）：

```json
"historyPaths": [
  "where-which",
  {"path": "kotoba-oheya", "note": "旧名「ことばのおへや」"}
]
```

```json
"historyPaths": [
  "typing-pc",
  {"path": "cmd-typing.html"},
  {"path": "index.html", "rev": "c8e2452~1", "note": "typing-pc/ に移すまではトップの index.html が本体だった"}
]
```

`rev` を付けると「そのコミットまでの履歴だけ」を数えます（トップの `index.html` は途中からランチャーになったため）。

集計スクリプトは全履歴の移動（rename）・複製（copy, 類似度70%以上）を調べ、作品より前から存在した別の場所から中身が入ってきているのに台帳に書かれていない場合、その作品の公開日を**確定させず「要確認」と表示**します。調べて「起源ではない」と分かったものは `lineageIgnore` に理由つきで書きます（例：旧トップの曲を暗算輪廻のエンディングに流用した、など）。

## 日付の決め方と取得方法

- **公開日**＝`historyPaths` のどれかに触れた最初のコミット。**最終更新日**＝最後のコミット。
- 日時はコミットの author date を **日本時間（UTC+09:00 固定）** に直したもの。この履歴では author date と committer date が日付単位で食い違うコミットはありません（集計時に確認済み）。
- `git log` をビルド時に1回だけ実行して `data/history.json` に保存します。閲覧時にGitHub APIは呼びません（レート制限・障害の影響を受けない）。
- 浅いclone（`--depth`）ではエラーで止まり、日付を書きません。
- 全作品共通の部品を一括で埋め込んだコミット（例 bd8d8c1）も「作品に関係するコミット」として最終更新日に数えます。
- 旧ページに手書きされていた `start`・`upd` は使っていません（例：CMDタイピングの手書き開始日 2026-11-10 は、リポジトリ最初のコミット 2026-11-11 より前）。

## 自動集計（GitHub Actions）と復旧

`tools/update-history.yml` は、採用が決まったら `.github/workflows/` に置くための設定です（比較中は動かしていません）。

- main への push で集計し、history.json が変わったときだけ bot がコミットします。
- 標準の `GITHUB_TOKEN` だけを使い、追加のトークン・有料サービスは不要。権限は `contents: write` のみ。
- bot のコミットはワークフローを再起動しないうえ、history.json だけの変更は `paths-ignore` で除外しているので、無限ループになりません。
- 失敗しても前回の history.json がそのまま表示されます。手元で `python3 tools/build_history.py` → コミット → push で復旧できます。GitHubの Actions 画面から「Run workflow」で手動実行もできます。

## 本番への切り替え（採用が決まったら）

1. `index.html`・`archive/`・`common/`・`data/` をリポジトリ直下へ、`brain/index.html` を `brain/` へ移す（旧BRAINは `brain/v1/` などに退避する場合、その中の `../assets/` を `../../assets/` に直す）。
2. `common/site.js` の `ROOT_FROM_ASSETS` を `'../'` に直す（1か所）。
3. `tools/build_history.py` を直下の `tools/` へ移す（パスは自動で決まる）。`.github/workflows/update-history.yml` を置く場合は、`run:` の行が `python3 tools/build_history.py` になっていることを確認。
4. `toybox/`・`lab/`・`utility/` の index.html を `migration/` の同名ファイルに置き換える（旧URL・ブックマークは作品一覧の該当種類へ転送）。`shared/roomnav.js` は使われなくなりますが、消さずに残しても害はありません。
5. 作品フォルダ・作品の中身・保存データ（localStorage）には触れません。このサイトが使う保存キーは `izSite.` で始まる表示設定だけです。
