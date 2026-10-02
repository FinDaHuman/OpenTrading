/**
 * Preset awareness for MCP tools, mirroring `MCP-server/src/opentrading_mcp/server.py`
 * (PRESET_MODULES). The deployed server serves `--preset all`, so `tools/list` returns
 * every tool; the configured preset (server entry `preset` in mcp.json, default `market`)
 * decides which subset gets registered for the model. Tools outside the table always
 * pass through, so other MCP servers and future tools are never hidden.
 *
 * Like opencode: the model reads the tool list directly — no LLM router picks tools.
 * Skills (`load_skill`) guide the workflow; the model picks tools from what it sees.
 */

export const PRESETS = ["market", "scan", "quant", "brief", "intel", "all"] as const
export type PresetName = (typeof PRESETS)[number]

export const PRESET_LABEL: Record<PresetName, string> = {
  market: "giá, chỉ số, OHLCV, dòng tiền VN & thế giới, BCTC/chỉ số tài chính theo quý (vs_*), listing, crypto, web",
  scan: "sàng lọc cổ phiếu (stock_screener, signals_scan), định giá & forensic từng mã, holders/insider, watchlist/cảnh báo",
  quant: "backtest, factors, rủi ro danh mục, tối ưu, scenario",
  brief: "tin tức, lịch sự kiện & vĩ mô, brief_build",
  intel: "odds/dự đoán, so sánh tài sản, geo/regime, bằng chứng",
  all: "tất cả tool",
}

/** Tool names per preset, extracted from the server's PRESET_MODULES (2026-10-02). */
const PRESET_TOOLS: Record<Exclude<PresetName, "all">, readonly string[]> = {
  market: [
    "breadth_scan", "crypto_derivs", "crypto_spot", "dnse_foreign_flow", "dnse_indices",
    "dnse_latest_trade", "dnse_market_status", "dnse_ohlc_history", "dnse_orderbook",
    "dnse_vn30f1m_live", "dnse_working_dates", "dnse_ws_snapshot", "exchange_calendar",
    "market_candles_batch", "market_movers", "market_overview", "market_snapshot",
    "source_status", "symbol_lookup", "vn_company", "vn_crypto_ohlv", "vn_equity_ohlcv",
    "vn_equity_quote_batch", "vn_forex_ohlcv", "vn_fundamentals", "vn_futures_ohlcv",
    "vn_global_index", "vn_index_ohlcv", "vn_listing", "vn_msn_fx_gold", "vn_quote_history",
    "vn_reference", "vn_retail_fx", "vn_retail_gold", "vn_trades", "vs_auth_status",
    "vs_categories", "vs_company_info", "vs_currency", "vs_documents", "vs_financeinfo",
    "vs_financial_norms", "vs_financial_terms", "vs_gics_index", "vs_indicator_data",
    "vs_industry_heatmap", "vs_industry_tree", "vs_market_index", "vs_market_info",
    "vs_market_price", "vs_nn_flow", "vs_overview_trading", "vs_selftrading",
    "vs_trading_info", "vs_xnk_detail", "web_fetch", "web_search", "yf_alloc_history",
    "yf_commodities", "yf_global_indices", "yf_market_pins", "yf_mega_flows",
    "yf_oracle_markets", "yf_regime_assets", "yf_world_indices", "yf_yield_curve",
  ],
  scan: [
    "alert_check", "alert_create", "alert_delete", "alert_list", "alert_pause",
    "alert_resume", "analyst_consensus", "block_trades", "company_events", "compare_assets",
    "dividends_splits", "doctor", "event_calendar_vn", "event_stats", "financial_detail",
    "financial_ratios", "financial_statements", "fred_series", "futures_basis", "holders",
    "insider_trading", "ipo_calendar_vn", "money_flow", "pattern_match", "peer_compare",
    "planned_targets", "run_get", "runs_list", "sector_performance", "sentiment_score",
    "signals_scan", "signals_screener_columns", "signals_technical", "snapshot_history",
    "stock_forensic", "stock_overview", "stock_screener", "valuation_run", "watchlist_add",
    "watchlist_create", "watchlist_delete", "watchlist_get", "watchlist_list",
    "watchlist_remove", "watchlist_update", "world_fear_greed", "world_macro_country",
  ],
  quant: [
    "backtest_strategies", "correlation_matrix", "param_sweep", "portfolio_optimize",
    "quant_backtest", "quant_factors", "quant_risk", "scenario_simulate", "seasonality",
  ],
  brief: ["brief_build", "corporate_calendar", "economic_calendar", "macro_events_vn", "news_market", "news_symbol", "sbv_rates"],
  intel: [
    "assets_rotation", "compare_equities", "evidence_bundle", "geo_intel", "oracle_meta",
    "polymarket_event", "web_fetch", "web_search", "world_prediction_odds",
  ],
}

export function isPreset(value: unknown): value is PresetName {
  return typeof value === "string" && (PRESETS as readonly string[]).includes(value)
}

/** Which presets a raw tool name belongs to; empty for tools added after this table. */
export function presetsOf(rawToolName: string): PresetName[] {
  const hits: PresetName[] = []
  for (const preset of PRESETS) {
    if (preset === "all") continue
    if (PRESET_TOOLS[preset as keyof typeof PRESET_TOOLS].includes(rawToolName)) hits.push(preset)
  }
  return hits
}

/** The registered tool names of one preset (`all` = union). */
export function toolsInPreset(preset: PresetName): readonly string[] {
  if (preset === "all") return Object.values(PRESET_TOOLS).flat()
  return PRESET_TOOLS[preset]
}

/** Per-preset tool counts for a server, plus `khác` for names outside the table. */
export function presetCounts(rawNames: string[]): Record<PresetName | "khác", number> {
  const counts = { market: 0, scan: 0, quant: 0, brief: 0, intel: 0, all: 0, khác: 0 }
  for (const name of rawNames) {
    counts.all++
    const presets = presetsOf(name)
    if (presets.length === 0) counts["khác"]++
    for (const preset of presets) counts[preset]++
  }
  return counts
}
