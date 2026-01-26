#!/usr/bin/env python3
import argparse, csv, json, os

def as_bool(x):
    if x is None:
        return False
    s = str(x).strip().lower()
    return s in ("true", "t", "1", "yes", "y")

def ensure_dir(path):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)

def main():
    ap = argparse.ArgumentParser(description="Convert verses.tsv -> verses.json for learn-stotras")
    ap.add_argument("--in", dest="inp", required=True, help="Input TSV path")
    ap.add_argument("--out", dest="out", required=True, help="Output JSON path")
    args = ap.parse_args()

    rows = []
    with open(args.inp, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for r in reader:
            if not any((v or "").strip() for v in r.values()):
                continue
            rows.append(r)

    out = []
    for r in rows:
        vid = (r.get("id") or "").strip()
        if not vid:
            continue

        full = (r.get("full") or "").strip()
        p1 = (r.get("p1") or "").strip()
        p2 = (r.get("p2") or "").strip()
        p3 = (r.get("p3") or "").strip()
        p4 = (r.get("p4") or "").strip()

        pr_p1 = ((r.get("pr_p1") or "").strip()) or p1
        pr_p2 = ((r.get("pr_p2") or "").strip()) or p2
        pr_p3 = ((r.get("pr_p3") or "").strip()) or p3
        pr_p4 = ((r.get("pr_p4") or "").strip()) or p4

        needs_split = as_bool(r.get("needs_split_practice"))
        has_p12 = as_bool(r.get("has_p12"))
        has_p34 = as_bool(r.get("has_p34"))

        mode = (r.get("mode") or "").strip() or "normal"

        audio = {
            "p1": f"{vid}_p1.mp3",
            "p2": f"{vid}_p2.mp3",
            "p3": f"{vid}_p3.mp3",
            "p4": f"{vid}_p4.mp3",
            "p12": f"{vid}_p12.mp3",
            "p34": f"{vid}_p34.mp3",
            "full": f"{vid}_full.mp3",
        }

        out.append({
            "id": vid,
            "title": (r.get("title") or vid).strip(),
            "meter": (r.get("meter") or "").strip(),
            "full": full,
            "text": {"p1": p1, "p2": p2, "p3": p3, "p4": p4},
            "practice": {"p1": pr_p1, "p2": pr_p2, "p3": pr_p3, "p4": pr_p4},
            "needsSplitPractice": needs_split,
            "available": {"p12": has_p12, "p34": has_p34},
            "audio": audio,
            "gloss": {
                "sa": (r.get("artha_sa") or "").strip(),
                "en": (r.get("meaning_en") or "").strip()
            },
            "mode": mode
        })

    ensure_dir(args.out)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(out)} verses to {args.out}")

if __name__ == "__main__":
    main()
