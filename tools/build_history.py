#!/usr/bin/env python3
"""作品台帳（data/works.json）とGit履歴から、公開日・最終更新日を集計して data/history.json を作る。

  公開日     = その作品に関係する最初のコミットの日付
  最終更新日 = その作品に関係する最後のコミットの日付
  日付       = コミットの author date を日本時間（UTC+09:00）に直した日付

使い方（リポジトリのどこからでも可）:
  python3 tools/build_history.py          # 集計して history.json を更新
  python3 tools/build_history.py --check  # 書き込まずに確認だけ（未登録フォルダ・要確認の作品を表示）
  python3 tools/build_history.py --add-stubs  # 未登録の作品フォルダを works.json に仮登録

標準ライブラリだけで動く（Python 3.8 以上）。浅いclone（--depth）では日付を判定せず、エラーで止まる。
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9), "JST")
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
WORKS_JSON = os.path.join(SITE, "data", "works.json")
HISTORY_JSON = os.path.join(SITE, "data", "history.json")

# 複製（コピー）とみなす類似度の下限。音声ファイルどうし等の偶然の一致を拾わないよう高めにする
COPY_MIN = 70


def git(*args, root=None):
    r = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise SystemExit("git " + " ".join(args) + " に失敗しました:\n" + r.stderr.strip())
    return r.stdout


def to_jst(iso):
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(JST)
    return dt


def norm_path(p):
    return p.strip("/")


def under(path, base):
    base = norm_path(base)
    return path == base or path.startswith(base + "/")


def main():
    args = set(sys.argv[1:])
    root = git("rev-parse", "--show-toplevel", root=SITE).strip()
    if git("rev-parse", "--is-shallow-repository", root=root).strip() == "true":
        raise SystemExit("浅いclone（履歴の一部しかない状態）では日付を判定しません。"
                         "`git fetch --unshallow` してから実行してください。")

    with open(WORKS_JSON, encoding="utf-8") as f:
        reg = json.load(f)
    works = reg["works"]
    site_dir = os.path.relpath(SITE, root).replace(os.sep, "/")

    # 全コミット: hash -> (author date JST, subject)
    meta = {}
    for line in git("log", "--format=%H%x09%aI%x09%s", root=root).splitlines():
        h, iso, subj = line.split("\t", 2)
        meta[h] = (to_jst(iso), subj)

    # 移動（rename）・複製（copy）の記録を全履歴から1回で拾う
    lineage = []  # (commit, kind, similarity, src, dst)
    cur = None
    for line in git("log", "-M", "-C", "--find-copies-harder", "--name-status", "--format===%H", root=root).splitlines():
        if line.startswith("=="):
            cur = line[2:]
            continue
        if line[:1] in ("R", "C"):
            parts = line.split("\t")
            kind, sim = parts[0][0], int(parts[0][1:] or 0)
            if kind == "C" and sim < COPY_MIN:
                continue
            lineage.append((cur, kind, sim, parts[1], parts[2]))

    first_seen_cache = {}

    def first_seen(path):
        if path not in first_seen_cache:
            out = git("log", "--format=%H", "--reverse", "--", path, root=root).split()
            first_seen_cache[path] = meta[out[0]][0] if out else None
        return first_seen_cache[path]

    # 台帳にない作品フォルダ（index.html を持つトップレベルのフォルダ）
    known = {w["path"].split("/")[0] for w in works}
    for w in works:
        for p in (w.get("historyPaths") or []):
            known.add((p["path"] if isinstance(p, dict) else p).split("/")[0])
    known |= set(reg.get("notWorks", {}).keys())
    known.add(site_dir.split("/")[0])
    tracked_dirs = {p.split("/")[0] for p in git("ls-files", root=root).splitlines() if "/" in p}
    unregistered = sorted(d for d in tracked_dirs
                          if d not in known and not d.startswith(".")
                          and os.path.isfile(os.path.join(root, d, "index.html")))

    if "--add-stubs" in args and unregistered:
        for d in unregistered:
            works.insert(0, {"id": d, "path": d + "/", "title": d, "titleEn": d.upper(), "category": "lab",
                             "summary": "", "status": "test"})
            print("  works.json に仮登録: %s（title・category・summary を直してください）" % d)
        with open(WORKS_JSON, "w", encoding="utf-8") as f:
            json.dump(reg, f, ensure_ascii=False, indent=2)
            f.write("\n")
        unregistered = []

    result = {}
    for w in works:
        wid = w["id"]
        hp = w.get("historyPaths") or [w["path"].split("/")[0]]
        specs = [p if isinstance(p, dict) else {"path": p} for p in hp]
        commits = set()
        per_path = []
        for s in specs:
            rev = s.get("rev", "HEAD")
            hs = git("log", "--format=%H", rev, "--", s["path"], root=root).split()
            per_path.append((s, set(hs)))
            commits |= set(hs)
        entry = {"paths": [s["path"] + ("@" + s["rev"] if s.get("rev") else "") for s in specs]}
        if not commits:
            entry.update(status="none", commits=0)
            result[wid] = entry
            continue
        ordered = sorted(commits, key=lambda h: meta[h][0])
        f, l = ordered[0], ordered[-1]

        def pack(h):
            dt, subj = meta[h]
            return {"date": dt.strftime("%Y-%m-%d"), "time": dt.strftime("%H:%M"), "commit": h, "subject": subj}

        entry["first"] = pack(f)
        entry["last"] = pack(l)
        entry["commits"] = len(commits)
        entry["days"] = sorted({meta[h][0].strftime("%Y-%m-%d") for h in commits})

        # 移動・複製で入ってきたのに、元の履歴が台帳に書かれていないものを探す
        ignore = {norm_path(x["from"] if isinstance(x, dict) else x) for x in w.get("lineageIgnore", [])}
        flags = []
        first_dt = meta[f][0]
        for (c, kind, sim, src, dst) in lineage:
            inside_dst = any(c in hs and under(dst, s["path"]) for s, hs in per_path)
            if not inside_dst:
                continue
            if any(under(src, s["path"]) for s in specs):
                continue  # 作品の中での移動、または台帳に書いてある旧パス
            if norm_path(src) in ignore or any(under(src, i) for i in ignore):
                continue
            src_first = first_seen(src)
            if src_first and src_first < first_dt:
                flags.append({"kind": "移動" if kind == "R" else "複製", "similarity": sim,
                              "from": src, "to": dst, "commit": c})
        entry["status"] = "unverified" if flags else "ok"
        if flags:
            entry["flags"] = flags
        result[wid] = entry

    work_commits = set()
    for e in result.values():
        if e.get("last"):
            work_commits.add(e["last"]["commit"])
    latest = max(work_commits, key=lambda h: meta[h][0]) if work_commits else None

    out = {
        "note": "build_history.py が自動生成。手で編集しない。",
        "rule": "公開日=作品に関係する最初のコミット、最終更新日=最後のコミット。日付はコミットのauthor dateを日本時間(UTC+09:00)に換算。",
        "timezone": "Asia/Tokyo (UTC+09:00)",
        "repository": reg.get("repository", ""),
        "latestWorkCommit": latest,
        "works": result,
        "unregistered": unregistered,
    }

    # 表示
    bad = [k for k, v in result.items() if v["status"] != "ok"]
    print("作品 %d 件を集計（要確認 %d 件・履歴なし %d 件）" % (
        len(result), sum(v["status"] == "unverified" for v in result.values()),
        sum(v["status"] == "none" for v in result.values())))
    for k in bad:
        v = result[k]
        if v["status"] == "none":
            print("  履歴なし: %s（historyPaths を確認）" % k)
        for fl in v.get("flags", []):
            print("  要確認: %s ← %s %s（%s, %s）" % (k, fl["from"], fl["kind"], fl["to"], fl["commit"][:7]))
    for d in unregistered:
        print("  未登録の作品フォルダ: %s/" % d)

    if "--check" in args:
        return

    # 中身が変わったときだけ書き込む（generatedAt だけの差分コミットを作らない）
    old = None
    if os.path.exists(HISTORY_JSON):
        with open(HISTORY_JSON, encoding="utf-8") as f:
            try:
                old = json.load(f)
            except ValueError:
                old = None
    if old is not None:
        o = dict(old)
        o.pop("generatedAt", None)
        if o == out:
            print("history.json は最新です（変更なし）")
            return
    out = {"generatedAt": datetime.now(JST).isoformat(timespec="seconds"), **out}
    with open(HISTORY_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("history.json を更新しました")


if __name__ == "__main__":
    main()
