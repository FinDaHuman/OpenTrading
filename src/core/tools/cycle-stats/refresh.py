#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cycle-stats refresh worker (called by harness tool cycle_stats_refresh).

Subcommands (JSON to stdout):
  check                          -- cache coverage, no fetch
  refresh_batch --symbols A B .. -- incremental fetch + overlap-validate + append
  finalize [--extra-tet YYYY-MM-DD ...] -- recompute all tables from cache

Overlap rule (user-locked): last 10 cached closes vs fresh; any relative
deviation > 0.5% triggers full re-fetch of that symbol.
Requires: python3 + vnstock + pandas (vnstock pulls pandas).
"""
import argparse
import json
import math
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

TOOL = "cycle_stats_refresh"
MEMBERS_VERSION = "v1"
OVERLAP_N = 10
TOLERANCE = 0.005
FULL_START = "2018-01-01"
VNINDEX_START = "2011-01-01"

INDICES = [
    "VNINDEX", "VN30", "VNFIN", "VNFINLEAD", "VNMAT", "VNREAL", "VNUTI",
    "VNIT", "VNSI", "HNXINDEX", "HNX30",
]

BASKETS = {
    "bank": ["VCB", "BID", "CTG", "TCB", "MBB", "ACB", "VPB", "STB", "HDB", "SHB", "OCB", "VIB", "TPB", "BVB"],
    "securities": ["SSI", "HCM", "VCI", "VND", "SHS", "BVS", "VDS", "MBS", "APG", "PSI"],
    "realestate": ["VHM", "VIC", "VRE", "NVL", "DXG", "NLG", "KDH", "KBC", "PDR", "SJS", "DIG", "ITA"],
    "oilgas": ["GAS", "BSR", "PVS", "PVD", "PVB", "PLX", "OIL", "PJT"],
    "steel": ["HPG", "HSG", "NKG", "VGS", "POM"],
    "utility": ["POW", "PC1", "NT2", "GEG", "REE", "DHP"],
    "tech": ["FPT", "CMG", "ELC"],
    "retail": ["MWG", "FRT", "DGW", "PNJ"],
    "consumer": ["VNM", "MSN", "SAB"],
    "transport": ["GMD", "HAH", "VSC"],
    "chemical": ["DGC", "DCM", "DPM"],
    "food": ["HAG", "VCF", "SFN"],
    "insurance": ["BVH"],
    "construction": ["CTD", "VCG", "CII"],
    "telecom": ["VGI"],
}

TETS = [
    "2012-01-23", "2013-02-10", "2014-01-31", "2015-02-19", "2016-02-08",
    "2017-01-28", "2018-02-16", "2019-02-05", "2020-01-25", "2021-02-12",
    "2022-02-01", "2023-01-22", "2024-02-10", "2025-01-29", "2026-02-17",
    "2027-02-06",
]

ALL_SYMBOLS = INDICES + sorted({s for v in BASKETS.values() for s in v})

DATA_DIR = None


def data_dir() -> Path:
    d = Path(DATA_DIR or os.environ.get("OT_CYCLE_DIR", "")) if (DATA_DIR or os.environ.get("OT_CYCLE_DIR")) else None
    base = d if d else Path.home() / "cycle_stats"
    base.mkdir(parents=True, exist_ok=True)
    return base


def wm_path() -> Path:
    return data_dir() / "watermark.json"


def load_watermark() -> dict:
    try:
        return json.loads(wm_path().read_text())
    except Exception:
        return {"symbols": {}, "members_version": MEMBERS_VERSION}


def save_watermark(wm: dict) -> None:
    wm_path().write_text(json.dumps(wm, ensure_ascii=False, indent=1))


def load_rows(sym: str) -> list:
    try:
        rows = json.loads((data_dir() / f"{sym}.json").read_text())
        return sorted(rows, key=lambda r: r["t"])
    except Exception:
        return []


def save_rows(sym: str, rows: list) -> None:
    (data_dir() / f"{sym}.json").write_text(
        json.dumps(sorted(rows, key=lambda r: r["t"]), ensure_ascii=False))


def fetch_range(sym: str, start: str, end: str) -> list:
    try:
        from vnstock.api.quote import Quote
    except ImportError as exc:
        raise RuntimeError("thieu vnstock (pip install vnstock pandas)") from exc
    last = None
    for attempt in range(3):
        try:
            q = Quote(symbol=sym.upper(), source="VCI")
            df = q.history(start=start, end=end, interval="1D")
            if df is None or len(df) == 0:
                raise ValueError("empty frame")
            import pandas as _pd
            if isinstance(df.index, _pd.DatetimeIndex):
                times = df.index
                recs = [row for _, row in df.iterrows()]
            else:
                tcol = "time" if "time" in df.columns else df.columns[0]
                times = _pd.to_datetime(df[tcol])
                recs = [row for _, row in df.iterrows()]
            out = []
            for ts, row in zip(times, recs):
                t = str(ts)[:10]
                if len(t) != 10 or t[4] != "-":
                    raise ValueError(f"bad time value {t!r}")
                out.append({
                    "t": str(ts)[:10],
                    "o": float(row.get("open", 0) or 0),
                    "h": float(row.get("high", 0) or 0),
                    "l": float(row.get("low", 0) or 0),
                    "c": float(row.get("close", 0) or 0),
                    "v": float(row.get("volume", 0) or 0),
                })
            return sorted(out, key=lambda r: r["t"])
        except Exception as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"VCI fetch failed for {sym}: {last}")


def refresh_one(sym: str, today: str) -> dict:
    sym = sym.upper()
    cached = load_rows(sym)
    have = {r["t"] for r in cached}
    if cached:
        wm_date = cached[-1]["t"]
        start = (date.fromisoformat(wm_date) - timedelta(days=20)).isoformat()
    else:
        wm_date = None
        start = VNINDEX_START if sym == "VNINDEX" else FULL_START
    fresh = fetch_range(sym, start, today)
    fresh_by_t = {r["t"]: r for r in fresh}
    if cached:
        overlap = [r for r in cached[-OVERLAP_N:] if r["t"] in fresh_by_t]
        breached = False
        for r in overlap:
            old_c, new_c = r["c"], fresh_by_t[r["t"]]["c"]
            if old_c and abs(new_c - old_c) / abs(old_c) > TOLERANCE:
                breached = True
                break
        if breached or not overlap:
            full = fetch_range(sym, VNINDEX_START if sym == "VNINDEX" else FULL_START, today)
            save_rows(sym, full)
            return {"symbol": sym, "mode": "full_refetch", "rows": len(full),
                    "reason": "overlap_breach" if breached else "no_overlap"}
    added = 0
    for r in fresh:
        if r["t"] not in have:
            cached.append(r)
            added += 1
    save_rows(sym, cached)
    return {"symbol": sym, "mode": "full_initial" if wm_date is None else "incremental",
            "added": added,
            "rows": len(cached), "last": cached[-1]["t"] if cached else None}


def jsafe(obj):
    if isinstance(obj, dict):
        return {k: jsafe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsafe(v) for v in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


def finalize_compute(extra_tet=None) -> dict:
    import pandas as pd

    closes = {}
    for sym in ALL_SYMBOLS:
        rows = load_rows(sym)
        if len(rows) > 50:
            closes[sym] = pd.Series({r["t"]: r["c"] for r in rows}, name=sym, dtype=float)
    px = pd.DataFrame(closes)
    px.index = pd.to_datetime(px.index)
    px = px.sort_index()
    if "VNINDEX" not in px.columns:
        raise RuntimeError("cache missing VNINDEX — run refresh_batch first")

    def basket(syms):
        use = [s for s in syms if s in px.columns]
        rets = px[use].pct_change(fill_method=None)
        n_ok = rets.notna().sum(axis=1)
        r = rets.mean(axis=1)
        r[n_ok < max(1, len(syms) // 3)] = float("nan")
        # Floor coverage ở 2018-10-01: VCI community trả limit không nhất
        # quán (vài mã vieux có data từ 2017), floor giữ sample ổn định.
        # Giữ nguyên full index (không truncate) để VNINDEX không bị cắt.
        r.loc[r.index < pd.Timestamp("2018-10-01")] = float("nan")
        return r

    baskets = {k: basket(v) for k, v in BASKETS.items()}
    bdf = pd.DataFrame(baskets)
    bdf["VNINDEX"] = px["VNINDEX"].pct_change(fill_method=None)
    out = {"range": [str(px.index.min().date()), str(px.index.max().date())],
           "symbols": len(closes)}
    mb = (1 + bdf).resample("ME").prod(min_count=1) - 1
    mb = mb[mb["VNINDEX"].notna()]
    mb.index = mb.index.to_period("M")
    mean_t = (mb.groupby(mb.index.month).mean() * 100).round(2)
    hit_t = (mb.groupby(mb.index.month).apply(
        lambda g: (g > 0).sum() / g.notna().sum() * 100).round(0))
    rel = mb.sub(mb["VNINDEX"], axis=0)
    rel_t = (rel.groupby(rel.index.month).mean() * 100).round(2)
    out["month_mean"] = jsafe(mean_t.to_dict())
    out["month_hit"] = jsafe(hit_t.to_dict())
    out["month_relative"] = jsafe(rel_t.to_dict())
    vi = px["VNINDEX"].dropna()
    vm = ((1 + vi.pct_change(fill_method=None)).resample("ME").prod(min_count=1) - 1).dropna()
    vm.index = vm.index.to_period("M")
    out["vnindex_month"] = jsafe({
        int(m): {"n": int(len(v)), "hit": round(float((v > 0).mean()) * 100, 1),
                 "mean": round(float(v.mean()) * 100, 2),
                 "median": round(float(v.median()) * 100, 2)}
        for m, v in vm.groupby(vm.index.month)})
    tets = sorted(set(TETS + (extra_tet or [])))
    tet_rows = {}
    for c in bdf.columns:
        s = bdf[c].dropna()
        pre, post = [], []
        for tx in tets:
            tet = pd.Timestamp(tx)
            before = s.index[s.index < tet]
            after = s.index[s.index >= tet]
            if len(before) < 6 or len(after) < 5:
                continue
            pre.append(float((1 + s.loc[:before[-1]].tail(6)).prod() - 1) * 100)
            post.append(float((1 + s.loc[after[0]:].head(5)).prod() - 1) * 100)
        if len(pre) >= 5:
            tet_rows[c] = {
                "pre5_mean": round(sum(pre) / len(pre), 2),
                "pre5_hit": round(sum(1 for x in pre if x > 0) / len(pre) * 100, 1),
                "post5_mean": round(sum(post) / len(post), 2),
                "post5_hit": round(sum(1 for x in post if x > 0) / len(post) * 100, 1),
                "n": len(pre)}
    out["tet"] = tet_rows
    rel_m = mb.sub(mb["VNINDEX"], axis=0)
    pairs = [("bank", "securities"), ("bank", "realestate"), ("bank", "oilgas"),
             ("bank", "steel"), ("securities", "bank"), ("securities", "realestate"),
             ("securities", "tech"), ("realestate", "securities"), ("realestate", "oilgas"),
             ("oilgas", "bank"), ("steel", "securities"), ("chemical", "bank"),
             ("tech", "securities"), ("bank", "consumer")]
    chains = []
    for a, b in pairs:
        for h in (1, 3):
            sig = rel_m[a].rolling(h).sum().shift(1)
            df = pd.concat([sig, rel_m[b]], axis=1, keys=["sig", "nxt"]).dropna()
            up = df[df.sig > 0.02]
            if len(up) >= 10:
                chains.append({"pair": f"{a}RS{h}m->{b}", "n_up": int(len(up)),
                               "rel_mean": round(float(up["nxt"].mean()) * 100, 2),
                               "rel_hit": round(float((up["nxt"] > 0).mean()) * 100, 1)})
    out["chains"] = chains
    peaks, troughs = {}, {}
    for c in INDICES:
        if c not in px.columns:
            continue
        s = px[c].dropna()
        for y, seg in s.groupby(s.index.year):
            y = int(y)
            peaks.setdefault(y, {})[c] = str(seg.idxmax().date())
            troughs.setdefault(y, {})[c] = str(seg.idxmin().date())
    out["peaks"] = peaks
    out["troughs"] = troughs
    yr = (1 + bdf).resample("YE").prod(min_count=1) - 1
    yr.index = yr.index.year
    out["yearly"] = jsafe((yr.T * 100).round(1).to_dict())
    # trough events: drawdown >15% + recovery >20% -> 3M forward per basket
    vi_full = px["VNINDEX"].dropna()
    events = []
    peak = vi_full.iloc[0]
    state, t_px = "up", None
    for d, v in vi_full.items():
        if v > peak:
            peak = v
            if state == "down" and t_px is not None and v / t_px - 1 >= 0.20:
                events.append(t_px_date)
                t_px = None
            state = "up"
        elif v < peak * 0.85 and state == "up":
            state = "down"
        if state == "down" and (t_px is None or v < t_px):
            t_px, t_px_date = v, d
    ev_rows = []
    for t in events:
        if t < pd.Timestamp("2018-10-01"):
            continue
        row = {"trough": str(t.date())}
        try:
            base = vi_full.loc[:t].iloc[-1]
            fwd = bdf.loc[t + pd.Timedelta(days=1): t + pd.Timedelta(days=95)]
            row["VNINDEX_3M"] = round(float(vi_full.loc[fwd.index[-1]] / base - 1) * 100, 1)
            for c in ["bank", "securities", "realestate", "oilgas", "steel", "utility", "tech"]:
                row[c] = round(float((1 + fwd[c].dropna()).prod() - 1) * 100, 1)
            ev_rows.append(row)
        except Exception:
            continue
    out["trough_events"] = ev_rows
    # weekly lead-lag for main pairs
    wk = (1 + bdf).resample("W-FRI").prod(min_count=1) - 1
    wk = wk[wk["VNINDEX"].notna()]
    mains = ["bank", "securities", "realestate", "oilgas", "steel", "utility", "tech", "VNINDEX"]
    ll = {}
    for a in mains:
        for b in mains:
            if a == b:
                continue
            c = wk[a].corr(wk[b].shift(-1))
            ll[f"{a}->{b}"] = round(float(c) * 100, 1) if c == c else None
    out["leadlag_1w"] = ll
    out["members_version"] = MEMBERS_VERSION
    return jsafe(out)


def main() -> int:
    global DATA_DIR
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["check", "refresh_batch", "finalize"])
    ap.add_argument("--home", default="")
    ap.add_argument("--symbols", nargs="*", default=[])
    ap.add_argument("--as-of", default="")
    ap.add_argument("--extra-tet", nargs="*", default=[])
    args = ap.parse_args()
    if args.home:
        DATA_DIR = os.path.join(args.home, "cycle_stats")

    if args.mode == "check":
        wm = load_watermark()
        syms = wm.get("symbols", {})
        lasts = [v.get("last") for v in syms.values() if v.get("last")]
        try:
            stale = (date.today() - date.fromisoformat(args.as_of)).days if args.as_of else None
        except ValueError:
            stale = None
        print(json.dumps({"as_of": args.as_of or None, "days_stale": stale,
                           "needs_refresh": bool(stale is not None and stale > 90),
                           "cached_symbols": len(syms),
                           "cache_range": [min(lasts, default=None), max(lasts, default=None)],
                           "members_version": wm.get("members_version", MEMBERS_VERSION)},
                          ensure_ascii=False))
        return 0

    if args.mode == "refresh_batch":
        syms = [s.upper() for s in args.symbols][:15]
        if not syms:
            print(json.dumps({"error": "empty symbols"}, ensure_ascii=False))
            return 1
        today = date.today().isoformat()
        updated, full, failed = [], [], []
        for s in syms:
            try:
                r = refresh_one(s, today)
                (full if r.get("mode") == "full_refetch" else updated).append(r)
            except Exception as exc:
                failed.append({"symbol": s, "error": str(exc)[:150]})
            time.sleep(0.5)
        wm = load_watermark()
        w = wm.get("symbols", {})
        for r in updated + full:
            w[r["symbol"]] = {"last": r.get("last"), "mode": r.get("mode"),
                              "members_version": MEMBERS_VERSION}
        wm["symbols"] = w
        wm["members_version"] = MEMBERS_VERSION
        save_watermark(wm)
        done = sum(1 for s in ALL_SYMBOLS if s in w)
        print(json.dumps({"updated": updated, "full_refetched": full, "failed": failed,
                           "progress": f"{done}/{len(ALL_SYMBOLS)}",
                           "remaining": [s for s in ALL_SYMBOLS if s not in w]},
                          ensure_ascii=False))
        return 0

    data = finalize_compute(args.extra_tet)
    print(json.dumps(data, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
