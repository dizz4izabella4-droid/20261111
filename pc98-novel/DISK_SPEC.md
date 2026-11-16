# PC98 NOVEL ディスク仕様（他AI向け・短縮版）

PC98 NOVEL の起動画面は、作品を「5.25インチFD」として本棚に並べ、ドライブに挿して遊ぶ形式です。
作品を1本作る = ディスクを1枚作る、という対応です。

## 1. 作品（ディスク）とは

- `pc98-novel/works/<id>/index.html` に置く、**単一HTMLファイル**（外部読み込みなし）。
- 既存エンジンで作る場合は、作品フォルダを `node pc98-novel/_engine/build.js <作品フォルダ> --out=pc98-novel/works/<id>/index.html` でビルドする（サンプルは引数なしで works/reiji-no-kiroku/ に出る）。
- `<id>` は半角英小文字・数字・ハイフンのみ（例: `reiji-no-kiroku`）。
- `config.json` の `gameId` は**作品ごとに重複しない値**にする（セーブが gameId 単位で分かれるため）。

