import { describe, expect, test } from "bun:test"
import { classifyContent, SECRET_PATTERNS, type ContentVerdict } from "../../src/core/memory/content"
import { normalizeBody } from "../../src/core/memory/schema"

const classify = (s: string) => classifyContent(normalizeBody(s))

// Fixture keys are built at runtime so no real-looking secret sits in the repo as one literal.
const tail = (n: number) => "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6".slice(0, n)
const SECRETS: [string, string, string][] = [
  ["secret_pem", ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" "), "-----BEGIN PUBLIC KEY-----"],
  ["secret_bearer", "Authorization: Bearer " + tail(20), "Authorization: Basic " + tail(20)],
  ["secret_openai", "key sk-" + tail(24), "risk-" + tail(24)],
  ["secret_openai", "sk-ant-api03-" + tail(20), "sk-short"],
  ["secret_groq", "gsk_" + tail(24), "gsk_short"],
  ["secret_nvidia", "nvapi-" + tail(24), "nvapi-short"],
  ["secret_google", "AIza" + tail(32), "AIza" + tail(10)],
  ["secret_xai", "xai-" + tail(24), "xai-short"],
  ["secret_hf", "hf_" + tail(24), "hf_short"],
  ["secret_github", "ghp_" + tail(24), "ghx_" + tail(24)],
  ["secret_github", "github_pat_" + tail(24), "github_pat_short"],
  ["secret_aws", "AKIA" + "ABCDEFGHIJKLMNOP", "AKIA" + "abcdefghijklmnop"],
]

describe("secret patterns", () => {
  test.each(SECRETS)("%s: matches the real shape and not a near miss", (reason, hit, miss) => {
    const got = classify(hit)
    expect(got.verdict).toBe("rejected")
    expect((got as Extract<ContentVerdict, { verdict: "rejected" }>).reasons).toContain(reason as never)
    const near = classify(miss)
    if (near.verdict === "rejected") expect(near.reasons).not.toContain(reason as never)
  })

  test("every declared pattern has a fixture", () => {
    const covered = new Set(SECRETS.map(([reason]) => reason))
    for (const { reason } of SECRET_PATTERNS) expect(covered.has(reason)).toBe(true)
  })

  test("reasons never echo the matched text", () => {
    const secret = "gsk_" + tail(24)
    expect(JSON.stringify(classify(`key là ${secret}`))).not.toContain(secret)
  })
})

type Row = [text: string, verdict: ContentVerdict["verdict"], reasons: string[]]
const CASES: Row[] = [
  // accepted: stable preferences with no figures
  ["Tôi không sử dụng margin", "accepted", []],
  ["Báo cáo cho tôi cần có kịch bản rủi ro", "accepted", []],
  ["Tôi thích đầu tư giá trị, nắm giữ dài hạn", "accepted", []],
  ["Tôi kỳ vọng báo cáo ngắn gọn", "accepted", []],
  ["Không dùng thuật ngữ khó, giải thích giá cả dễ hiểu", "accepted", []],

  // rejected: money amounts
  ["giá vốn 25.000 đ", "rejected", ["money_amount", "valuation_value"]],
  ["lãi 3 triệu mỗi tháng", "rejected", ["money_amount"]],
  ["cắt lỗ 10k", "rejected", ["money_amount", "valuation_value"]],
  ["Ngân sách 2tr", "rejected", ["money_amount"]],
  ["đã lỗ 10K rồi", "rejected", ["money_amount"]],
  ["tài khoản 500 VNĐ", "rejected", ["money_amount"]],
  ["tài khoản 500vnd", "rejected", ["money_amount"]],
  ["số dư 1,5 tỷ", "rejected", ["money_amount"]],
  ["ví có $20", "rejected", ["money_amount"]],
  ["ví có 20$", "rejected", ["money_amount"]],

  // rejected: valuation values
  ["P/E 12,4x là rẻ", "rejected", ["valuation_value"]],
  ["giá mục tiêu 45", "rejected", ["valuation_value"]],
  ["EPS: 3.200", "rejected", ["valuation_value"]],
  ["ROE 18% là tốt", "rejected", ["valuation_value"]],

  // rejected: forecasts
  ["HPG sẽ tăng 20% trong quý 4", "rejected", ["forecast"]],
  ["Dự báo VN-Index về 1.500 cuối năm", "rejected", ["forecast"]],
  ["Thị trường sẽ giảm tháng tới", "rejected", ["forecast"]],
  ["Tôi kỳ vọng lãi 15% năm nay", "rejected", ["forecast"]],

  // rejected: holdings
  ["tôi đang giữ 1000 cp HPG", "rejected", ["holding"]],
  ["Tôi mua thêm 500 cổ phiếu VCB", "rejected", ["holding"]],
  ["nắm 2 hợp đồng VN30F1M", "rejected", ["holding"]],

  // ambiguous: user thresholds and counts
  ["không vượt 20% danh mục cho một mã", "ambiguous", ["number_present"]],
  ["không mua cổ phiếu có P/E trên 20", "ambiguous", ["valuation_threshold", "number_present"]],
  ["không mua cổ phiếu có P/E không quá 15", "ambiguous", ["valuation_threshold", "number_present"]],
  ["luôn đưa ra 3 kịch bản", "ambiguous", ["number_present"]],
  ["Tôi kỳ vọng mỗi báo cáo có 3 kịch bản", "ambiguous", ["number_present"]],
  ["không mua quá 2 lô mỗi ngày", "ambiguous", ["number_present"]],
  ["đầu tư giá trị 3 năm", "ambiguous", ["number_present"]],

  // near misses for the money rule
  ["3 kịch bản", "ambiguous", ["number_present"]],
  ["10kg gạo", "ambiguous", ["number_present"]],
  ["20 điểm", "ambiguous", ["number_present"]],
  ["3 tr", "ambiguous", ["number_present"]],
  ["5 đợt", "ambiguous", ["number_present"]],
]

describe("classifyContent", () => {
  test.each(CASES)("%p → %s", (text, verdict, reasons) => {
    const got = classify(text)
    expect(got.verdict).toBe(verdict)
    const actual: string[] = got.verdict === "accepted" ? [] : [...got.reasons]
    expect(actual.sort()).toEqual([...reasons].sort())
  })

  test("case and spacing variants classify the same", () => {
    expect(classify("GIÁ VỐN 25.000 Đ").verdict).toBe("rejected")
    expect(classify("giá vốn 25.000đ").verdict).toBe("rejected")
    expect(classify("TÔI ĐANG GIỮ 1000 CP").verdict).toBe("rejected")
    expect(classify("Luôn Đưa Ra 3 Kịch Bản").verdict).toBe("ambiguous")
  })

  test("decomposed input is classified after normalization", () => {
    expect(classify("giá vốn 25.000 đ".normalize("NFD")).verdict).toBe("rejected")
  })
})
