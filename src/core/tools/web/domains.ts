/**
 * Domain presets for Vietnamese market research, and the hosts web_fetch may read without
 * asking (Claude Code asks per domain; the user chose to exempt Vietnamese finance, news
 * and government sources).
 */
export const PRESETS = {
  vn_finance: ["cafef.vn", "vietstock.vn", "ndh.vn", "ssi.com.vn", "hsx.vn", "hnx.vn", "vsd.vn", "fireant.vn", "tinnhanhchungkhoan.vn", "vneconomy.vn", "cafebiz.vn", "vnexpress.net"],
  vn_news: ["vnexpress.net", "tuoitre.vn", "thanhnien.vn", "vneconomy.vn", "vietnamnet.vn", "dantri.com.vn", "baodautu.vn", "nhandan.vn"],
  vn_official: ["sbv.gov.vn", "gso.gov.vn", "ssc.gov.vn", "mof.gov.vn", "hsx.vn", "hnx.vn", "vsd.vn", "chinhphu.vn"],
} as const

export type Preset = keyof typeof PRESETS

/** `cafef.vn` matches cafef.vn and s.cafef.vn, never notcafef.vn. */
export function hostMatches(host: string, domain: string) {
  const h = host.toLowerCase().replace(/\.$/, "")
  const d = domain.toLowerCase().replace(/^\*\./, "").replace(/^www\./, "")
  return h === d || h.endsWith(`.${d}`)
}

const EXEMPT = [...new Set(Object.values(PRESETS).flat())]

/** Read without a prompt: the presets' hosts and every *.gov.vn site. */
export function isPreapproved(host: string) {
  const h = host.toLowerCase()
  return h === "gov.vn" || h.endsWith(".gov.vn") || EXEMPT.some((d) => hostMatches(h, d))
}

/** Normalise a domain list from the model: bare hosts, no scheme or path. */
export function cleanDomains(list: string[] | undefined) {
  return (list ?? [])
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
}
