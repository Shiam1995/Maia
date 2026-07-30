"""Parse a pasted bibliography into individual references — no LLM involved.

The LLM path invents identifiers that never appeared in the source (measured
against a real bibliography: 5 of 8 arXiv ids were fabricated, one duplicated
from a different entry). This parser is deliberately literal — a link is only
ever taken from characters present in the text you pasted, so fabrication is
structurally impossible rather than merely unlikely.

Handles the shapes that cover almost every bibliography:
    [1] A. Author and B. Author. Title here. Venue, 2007.
    1. A. Author. Title here. Venue, 2007.
    A. Author, B. Author. Title here. Venue, 2007.     (blank-line separated)
"""
from __future__ import annotations

import re

_MARKER = re.compile(r"^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+")
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_URL = re.compile(r"https?://[^\s,;)\]]+", re.IGNORECASE)
_WWW = re.compile(r"\bwww\.[^\s,;)\]]+", re.IGNORECASE)
_DOI = re.compile(r"\b10\.\d{4,9}/[^\s,;)\]]+")
_ARXIV = re.compile(r"arXiv[:\s]\s*(\d{4}\.\d{4,5})", re.IGNORECASE)
# A token that reads as an initial: "R.", "R.M.", "L.-J.".
# Deliberately case-SENSITIVE — with re.IGNORECASE, [A-Z] also matches lowercase
# and surnames like "Cox" and "Ng" parse as three initials, swallowing the title.
_INITIALS = re.compile(r"^(?:[A-Z]\.?-?){1,4}$")
# "et al." closes an author list rather than continuing it.
_ET_AL = re.compile(r"^al$", re.IGNORECASE)
_TRAILING_YEAR = re.compile(r",\s*(?:19|20)\d{2}$")


def _dehyphenate(text: str) -> str:
    """Rejoin words a PDF split across a line break.

    Drops the hyphen for ordinary words (`Understand-\\ning` → `Understanding`)
    but keeps it inside a URL or domain, where it is real
    (`www.image-\\nnet.org` → `www.image-net.org`).
    """
    def join(m: re.Match) -> str:
        left, right = m.group(1), m.group(2)
        tail = left[-24:].lower()
        in_url = "://" in tail or "www." in tail or "/" in tail
        return left + ("-" if in_url else "") + right

    return re.sub(r"(\S*[A-Za-z0-9])-\n\s*([a-z]\S*)", join, text)


def split_entries(text: str) -> list[str]:
    """Break a pasted bibliography into one string per reference."""
    text = _dehyphenate(text.replace("\r\n", "\n"))
    lines = text.split("\n")

    # 1. explicit [n] / n. markers — the reliable case, and wrapped lines rejoin
    if sum(1 for ln in lines if _MARKER.match(ln)) >= 2:
        entries: list[str] = []
        cur: list[str] = []
        for ln in lines:
            if _MARKER.match(ln) and cur:
                entries.append(" ".join(cur))
                cur = []
            cur.append(ln.strip())
        if cur:
            entries.append(" ".join(cur))
        return [re.sub(r"\s+", " ", e).strip() for e in entries if e.strip()]

    # 2. blank-line separated blocks
    blocks = [b for b in re.split(r"\n\s*\n", text) if b.strip()]
    if len(blocks) >= 2:
        # Author-year bibliographies (no [n] markers) usually wrap without blank
        # lines between entries, so blank-line splitting can return a handful of
        # huge blocks holding dozens of references each — which is how a whole
        # citation went missing and only the model's truncated guess survived.
        # Try the author-start split on each block and take it when it clearly
        # finds more.
        out: list[str] = []
        for b in blocks:
            sub = _split_author_first(b)
            out.extend(sub if len(sub) > 1 else [b])
        return [re.sub(r"\s+", " ", e).strip() for e in out if e.strip()]

    # 3. a single unbroken block — author-start split, else one per line
    sub = _split_author_first(text)
    if len(sub) >= 2:
        return [re.sub(r"\s+", " ", e).strip() for e in sub if e.strip()]
    return [re.sub(r"\s+", " ", ln).strip() for ln in lines if len(ln.strip()) > 20]


# A line that opens a new citation in an author-first bibliography:
#   "Ramanan Sekar, Oleh Rybkin, … and Deepak Pathak."
#   "Hafner, D., Lillicrap, T., …"
# Two capitalised words, or a surname-comma-initial — enough to be a name, and
# specific enough that a wrapped title line ("Conference on Machine Learning")
# doesn't match on its own; the previous-line test below does the rest.
_AUTHOR_START = re.compile(
    r"^(?:[A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-\.]*){1,3},"      # Firstname Surname,
    r"|[A-Z][A-Za-z'’\-]+,\s*(?:[A-Z]\.\s*){1,4}"                    # Surname, A. B.
    r")"
)
# An entry ends on a year, a page range, a DOI/URL tail or a closing bracket.
_ENTRY_END = re.compile(r"(?:(?:19|20)\d{2}[a-z]?\.?|\d\.|\)|[/\w]\.)\s*$")


def _split_author_first(block: str) -> list[str]:
    """Split a marker-less bibliography where each entry starts with authors.

    A line only starts a new entry when it *looks like* an author list AND the
    text so far looks finished. Requiring both is what stops a wrapped title
    line that happens to begin with a name ("Minecraft demonstrations…") from
    cutting an entry in half.
    """
    lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
    if len(lines) < 4:
        return [block]
    entries: list[str] = []
    cur: list[str] = []
    for ln in lines:
        starts = bool(_AUTHOR_START.match(ln))
        finished = bool(cur) and bool(_ENTRY_END.search(cur[-1]))
        if starts and finished:
            entries.append(" ".join(cur))
            cur = []
        cur.append(ln)
    if cur:
        entries.append(" ".join(cur))
    # Only worth using if it actually broke things apart into plausible entries.
    return entries if len(entries) >= 2 else [block]


def title_of(entry: str) -> str:
    """The title, with the leading author run stripped.

    The author list ends at the first sentence break whose preceding word is not
    an initial or "et al" — that is what separates `A. Author and B. Author.`
    from the title. The title then runs to the next `.`, `?` or `!`, so
    `…for object recognition?` keeps its question mark.
    """
    s = _MARKER.sub("", entry, count=1).strip()
    start = 0
    for m in re.finditer(r"[.?!]\s+", s):
        words = s[: m.start()].split()
        prev = words[-1].rstrip(",") if words else ""
        if _INITIALS.match(prev) and not _ET_AL.match(prev):
            continue                      # still inside the author list
        start = m.end()                   # a surname, or "et al." — authors end here
        break
    rest = s[start:].strip() or s
    end = re.search(r"[.?!](?:\s|$)", rest)
    title = (rest[: end.end()] if end else rest).strip()
    title = title.rstrip(".").strip()
    # a bare citation like "ILSVRC-2012, 2012" carries the year, not a subtitle
    title = _TRAILING_YEAR.sub("", title).strip()
    return re.sub(r"\s+", " ", title)


def link_of(entry: str) -> str | None:
    """A link ONLY when it literally appears in the pasted text."""
    u = _URL.search(entry)
    if u:
        return u.group(0).rstrip(".,;")
    w = _WWW.search(entry)
    if w:
        return "https://" + w.group(0).rstrip(".,;")
    d = _DOI.search(entry)
    if d:
        return "https://doi.org/" + d.group(0).rstrip(".,;")
    a = _ARXIV.search(entry)
    if a:
        return "https://arxiv.org/abs/" + a.group(1)
    return None


def year_of(entry: str) -> int | None:
    """Publication year — the last one in the entry, which skips volume numbers
    and the years that appear inside conference names."""
    years = _YEAR.findall(entry)
    return int(years[-1]) if years else None


def parse(text: str) -> list[dict]:
    """Pasted text → [{title, year, link, raw}], in source order."""
    out: list[dict] = []
    for raw in split_entries(text):
        title = title_of(raw)
        if len(title) < 6:
            continue
        out.append({
            "title": title[:300],
            "year": year_of(raw),
            "link": link_of(raw),
            "raw": raw[:400],
        })
    return out
