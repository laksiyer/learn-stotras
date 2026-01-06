import csv, json, os, argparse, sys

# Universal TSV -> JSON converter for Learn Stotras
# Input TSV headers (canonical v1):
# id, title, meter, full, p1, p2, p3, p4,
# pr_p1, pr_p2, pr_p3, pr_p4,
# needs_split_practice, has_p12, has_p34,
# artha_sa, meaning_en

REQUIRED_COLS = [
    "id", "title", "meter", "full",
    "p1", "p2", "p3", "p4",
    "pr_p1", "pr_p2", "pr_p3", "pr_p4",
    "needs_split_practice", "has_p12", "has_p34",
    "artha_sa", "meaning_en"
]

def norm(s: str) -> str:
    return (s or "").strip()

def truthy(s: str) -> bool:
    return norm(s).lower() in {"true", "t", "1", "yes", "y"}

def fatal(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)

def main():
    ap = argparse.ArgumentParser(
        description="Convert stotra verses.tsv to verses.json (Nitishatakam-compatible structure)."
    )
    ap.add_argument(
        "--in", dest="tsv_path", default=None,
        help="Path to verses.tsv (default: <stotra_dir>/data/verses.tsv)"
    )
    ap.add_argument(
        "--out", dest="json_path", default=None,
        help="Path to output verses.json (default: <stotra_dir>/data/verses.json)"
    )
    ap.add_argument(
        "--stotra-dir", dest="stotra_dir", default=".",
        help="Stotra directory (default: .). Used to resolve default --in/--out and audio paths."
    )
    ap.add_argument(
        "--audio-subdir", dest="audio_subdir", default="audio",
        help="Audio directory name relative to stotra dir (default: audio)"
    )
    args = ap.parse_args()

    stotra_dir = args.stotra_dir
    tsv_path = args.tsv_path or os.path.join(stotra_dir, "data", "verses.tsv")
    json_path = args.json_path or os.path.join(stotra_dir, "data", "verses.json")
    audio_prefix = f"{args.audio_subdir}".rstrip("/")

    if not os.path.exists(tsv_path):
        fatal(f"Input TSV not found: {tsv_path}")

    verses = []

    with open(tsv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")

        # Validate headers
        if reader.fieldnames is None:
            fatal("TSV appears to have no header row.")

        missing = [c for c in REQUIRED_COLS if c not in reader.fieldnames]
        if missing:
            fatal(
                "Missing required columns in TSV: "
                + ", ".join(missing)
                + f"\nFound columns: {', '.join(reader.fieldnames)}"
            )

        for row in reader:
            vid = norm(row.get("id"))
            if not vid:
                continue

            def g(k: str) -> str:
                return norm(row.get(k))

            has_p12 = truthy(g("has_p12"))
            has_p34 = truthy(g("has_p34"))
            needs_split_practice = truthy(g("needs_split_practice"))

            p1 = g("p1"); p2 = g("p2"); p3 = g("p3"); p4 = g("p4")

            verse = {
                "id": vid,
                "title": g("title") or vid,
                "meter": g("meter") or "—",
                "full": g("full"),

                # canonical pāda split (always keep this for reference)
                "text": {"p1": p1, "p2": p2, "p3": p3, "p4": p4},

                # practice text (defaults to canonical if blank)
                "practice": {
                    "p1": g("pr_p1") or p1,
                    "p2": g("pr_p2") or p2,
                    "p3": g("pr_p3") or p3,
                    "p4": g("pr_p4") or p4,
                },

                # app.js uses this to hide P1..P4 buttons for special verses
                "needsSplitPractice": needs_split_practice,

                "available": {"p12": has_p12, "p34": has_p34},

"audio": {
  "p1": f"{vid}_p1.mp3",
  "p2": f"{vid}_p2.mp3",
  "p3": f"{vid}_p3.mp3",
  "p4": f"{vid}_p4.mp3",
  "p12": f"{vid}_p12.mp3" if has_p12 else None,
  "p34": f"{vid}_p34.mp3" if has_p34 else None,
  "full": f"{vid}_full.mp3",
},

                "gloss": {"sa": g("artha_sa"), "en": g("meaning_en")},
            }

            verses.append(verse)

    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(verses, f, ensure_ascii=False, indent=2)

    print(f"Generated {len(verses)} verses → {json_path}")

if __name__ == "__main__":
    main()
