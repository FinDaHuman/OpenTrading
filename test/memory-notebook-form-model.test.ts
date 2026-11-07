import { describe, expect, test } from "bun:test"
import type { NotebookEntry } from "../src/core/memory/notebook/admin"
import {
  constraintToDraft,
  fromStoreDay,
  guessKind,
  lessonToDraft,
  thesisToDraft,
  toStoreDay,
  type LessonDraft,
  type ThesisDraft,
} from "../src/core/memory/notebook/drafts"
import { fieldChanges, fieldCounts } from "../src/core/memory/notebook/form-model"
import { draftWarnings } from "../src/core/memory/notebook/warnings"

const HPG_V3: ThesisDraft = {
  text: "Hưởng lợi từ đầu tư công",
  detail: "Đầu tư công giải ngân mạnh năm 2026",
  conditions: ["Sai nếu biên gộp dưới 10% hai quý liền", "Sai nếu tồn kho tăng quá 30%"],
  reviewBy: "31/12/2026",
}

describe("drafts", () => {
  test("store versions become form drafts, dates as the user reads them", () => {
    expect(
      constraintToDraft({ id: 1, kind: "constraint", version: 2, text: "A", scope: "", source: "manual", createdAt: "" }),
    ).toEqual({ id: 1, version: 2, kind: "constraint", text: "A" })
    expect(
      thesisToDraft({
        subjectId: 3,
        version: 3,
        text: "T",
        conditions: ["c1"],
        reviewBy: "2026-12-31",
        validFrom: "",
        source: "manual",
      }),
    ).toEqual({ version: 3, text: "T", detail: undefined, conditions: ["c1"], reviewBy: "31/12/2026" })
    expect(
      lessonToDraft(
        {
          id: 7,
          version: 1,
          title: "Định giá",
          summary: "S",
          appliesTo: [5],
          tags: ["x"],
          source: "manual",
          createdAt: "",
        },
        (id) => (id === 5 ? "Ngân hàng" : `#${id}`),
      ),
    ).toEqual({
      id: 7,
      version: 1,
      title: "Định giá",
      summary: "S",
      appliesTo: [{ id: 5, display: "Ngân hàng" }],
      exceptions: undefined,
      detail: undefined,
      tags: ["x"],
    })
  })

  test("a review date is typed DD/MM/YYYY (or ISO) and stored as YYYY-MM-DD", () => {
    expect(toStoreDay("31/12/2026")).toBe("2026-12-31")
    expect(toStoreDay(" 1/2/2027 ")).toBe("2027-02-01")
    expect(toStoreDay("2026-12-31")).toBe("2026-12-31")
    expect(toStoreDay("")).toBeUndefined()
    expect(toStoreDay("31/02/2026")).toBe("invalid")
    expect(toStoreDay("cuối năm")).toBe("invalid")
    expect(fromStoreDay("2026-12-31")).toBe("31/12/2026")
    expect(fromStoreDay(undefined)).toBeUndefined()
  })
})

describe("fieldChanges", () => {
  test("lists only the fields that differ, conditions by position", () => {
    const after: ThesisDraft = { ...HPG_V3, conditions: [HPG_V3.conditions[0]!, "Sai nếu tồn kho tăng quá 25%"] }
    expect(fieldChanges("thesis", HPG_V3, after)).toEqual([
      {
        field: "conditions.1",
        label: "Điều kiện 2",
        before: "Sai nếu tồn kho tăng quá 30%",
        after: "Sai nếu tồn kho tăng quá 25%",
      },
    ])
  })

  test("an added or removed condition shows against an empty side", () => {
    const added: ThesisDraft = { ...HPG_V3, conditions: [...HPG_V3.conditions, "Sai nếu nợ vay tăng"] }
    expect(fieldChanges("thesis", HPG_V3, added)).toEqual([
      { field: "conditions.2", label: "Điều kiện 3", before: "", after: "Sai nếu nợ vay tăng" },
    ])
    const removed: ThesisDraft = { ...HPG_V3, conditions: [HPG_V3.conditions[0]!] }
    expect(fieldChanges("thesis", HPG_V3, removed)).toEqual([
      { field: "conditions.1", label: "Điều kiện 2", before: "Sai nếu tồn kho tăng quá 30%", after: "" },
    ])
  })

  test("text, date and detail each have their own line; spaces around and NFC forms do not count", () => {
    const after: ThesisDraft = {
      ...HPG_V3,
      text: "Hưởng lợi từ đầu tư công và giá thép phục hồi",
      reviewBy: "30/06/2027",
      detail: ` ${HPG_V3.detail!.normalize("NFD")} `,
    }
    expect(fieldChanges("thesis", HPG_V3, after).map((c) => c.label)).toEqual(["Văn bản", "Hạn xem lại"])
    expect(fieldChanges("thesis", HPG_V3, { ...HPG_V3, detail: "" }).map((c) => c.label)).toEqual(["Chi tiết"])
  })

  test("constraint and lesson fields", () => {
    expect(
      fieldChanges("constraint", { kind: "constraint", text: "Không margin" }, { kind: "constraint", text: "Không margin, kể cả T+0" }),
    ).toEqual([{ field: "text", label: "Văn bản", before: "Không margin", after: "Không margin, kể cả T+0" }])
    const lesson: LessonDraft = {
      title: "Định giá ngân hàng",
      summary: "Dùng P/B và ROE, không dùng P/E",
      appliesTo: [{ id: 5, display: "Ngân hàng" }],
      tags: ["định giá"],
    }
    const changed: LessonDraft = {
      ...lesson,
      appliesTo: [...lesson.appliesTo, { newName: "Chứng khoán", kind: "sector" }],
      tags: ["định giá", "ngân hàng"],
    }
    expect(fieldChanges("lesson", lesson, changed)).toEqual([
      { field: "appliesTo", label: "Áp dụng cho", before: "Ngân hàng", after: "Ngân hàng, Chứng khoán" },
      { field: "tags", label: "Tag", before: "định giá", after: "định giá, ngân hàng" },
    ])
  })
})

describe("fieldCounts", () => {
  const over = (counts: ReturnType<typeof fieldCounts>) => counts.filter((c) => c.over).map((c) => c.field)

  test("exactly at a limit is fine, one more is over", () => {
    const at = fieldCounts("lesson", { title: "a".repeat(120), summary: "s", appliesTo: [], tags: [] })
    expect(at.find((c) => c.field === "title")).toEqual({ field: "title", label: "Tiêu đề", count: 120, max: 120, over: false })
    expect(over(fieldCounts("lesson", { title: "a".repeat(121), summary: "s", appliesTo: [], tags: [] }))).toEqual(["title"])
  })

  test("counts characters as a reader sees them, after trimming", () => {
    const c = fieldCounts("constraint", { kind: "constraint", text: `  ${"à".normalize("NFD").repeat(200)}👍🏽  ` })
    expect(c.find((x) => x.field === "text")).toMatchObject({ count: 201, max: 200, over: true })
  })

  test("constraints show the running total of active ones, minus the one being edited", () => {
    const c = fieldCounts("constraint", { kind: "constraint", text: "x".repeat(80) }, { activeChars: 1_450 })
    expect(c.find((x) => x.field === "total")).toEqual({
      field: "total",
      label: "Tổng ràng buộc",
      count: 1_530,
      max: 1_500,
      over: true,
    })
    const style = fieldCounts("constraint", { kind: "style", text: "x".repeat(10) }, { activeChars: 21 })
    expect(style.find((x) => x.field === "total")).toMatchObject({ label: "Tổng cách trình bày", count: 31, max: 1_000 })
    expect(style.find((x) => x.field === "text")).toMatchObject({ max: 1_000 })
  })

  test("thesis: each condition out of 160, at most 8 conditions", () => {
    const counts = fieldCounts("thesis", { text: "t", conditions: Array.from({ length: 9 }, () => "c".repeat(161)) })
    expect(counts.find((c) => c.field === "conditions")).toMatchObject({ count: 9, max: 8, over: true })
    expect(counts.find((c) => c.field === "conditions.0")).toMatchObject({ label: "Điều kiện 1", count: 161, max: 160 })
  })

  test("decision fields", () => {
    const counts = fieldCounts("decision", { action: "a".repeat(121), reason: "r", basis: "none" })
    expect(over(counts)).toEqual(["action"])
  })
})

const entry = (group: NotebookEntry["group"], id: number, text: string): NotebookEntry => ({
  group,
  id,
  version: 1,
  title: text,
  text,
  detail: text,
  createdAt: "",
})
const EXISTING = [
  entry("constraint", 1, "Không dùng margin, kể cả T+0"),
  entry("constraint", 4, "Tối đa 20% danh mục cho một mã"),
  entry("style", 2, "Trả lời ngắn, có bảng"),
  entry("lesson", 7, "Định giá ngân hàng"),
]
const lessonDraft = (title: string, summary = "Tóm tắt"): LessonDraft => ({ title, summary, appliesTo: [], tags: [] })
const kinds = (w: ReturnType<typeof draftWarnings>) => w.map((x) => x.kind)

describe("draftWarnings: hard rules saved as lessons", () => {
  test.each([
    "Không bao giờ bắt đáy",
    "Tuyệt đối không margin",
    "Cấm bán khống",
    "Không được mua đuổi",
    "Tối đa 15% danh mục",
    "tối đa 15 % danh mục",
    "khong bao gio bat day",
  ])("«%s» warns", (title) => {
    const w = draftWarnings("lesson", lessonDraft(title), [])
    expect(kinds(w)).toEqual(["hard_rule"])
    expect(w[0]!.message).toContain("Bài học chỉ được model đọc khi cần, không luôn được áp dụng.")
    expect(w[0]!.message).toContain("Muốn luôn áp dụng thì lưu thành ràng buộc.")
  })

  test("the summary counts too; the message names the pattern, not the text", () => {
    const w = draftWarnings("lesson", lessonDraft("Giải ngân", "tuyệt đối không dồn một lần"), [])
    expect(w).toMatchObject([{ kind: "hard_rule", field: "summary" }])
    expect(w[0]!.message).toContain("(«tuyệt đối không»)")
    expect(w[0]!.message).not.toContain("dồn một lần")
  })

  test.each(["Dùng P/B và ROE, không dùng P/E", "Cảm nhận thị trường yếu", "Cám dỗ bắt đáy"])("«%s» does not warn", (t) => {
    expect(draftWarnings("lesson", lessonDraft(t, t), [])).toEqual([])
  })

  test("constraints never get the hard-rule warning", () => {
    expect(draftWarnings("constraint", { kind: "constraint", text: "Không bao giờ bắt đáy" }, [])).toEqual([])
  })
})

describe("draftWarnings: prices and forecasts", () => {
  test.each([
    "Sai nếu giá về dưới 20.000 đồng",
    "giá mục tiêu 32k",
    "dự báo lợi nhuận 2027 sẽ đạt 15.000 tỷ",
    "Giá hiện tại thấp",
    "Cổ phiếu sẽ lên",
    "lỗ 5 triệu",
    "30.000đ",
  ])("«%s» warns", (text) => {
    const w = draftWarnings("thesis", { text, conditions: [] }, [])
    expect(w).toMatchObject([{ kind: "figure", field: "text" }])
    expect(w[0]!.message).toBe(
      "Có vẻ đây là giá hoặc dự báo. Sổ ghi nhớ không phải nguồn số liệu; model sẽ lấy số mới bằng tool. Vẫn lưu nếu đây là ngưỡng của bạn.",
    )
  })

  test.each(["Sai nếu biên gộp dưới 10% hai quý liền", "Tối đa 20% danh mục cho một mã", "Không dùng margin, kể cả T+0", "Kế hoạch 2027"])(
    "«%s» does not warn",
    (text) => {
      expect(draftWarnings("thesis", { text, conditions: [text], detail: text }, [])).toEqual([])
    },
  )

  test("every text field of every form is checked, each field once", () => {
    const w = draftWarnings(
      "thesis",
      { text: "T", conditions: ["Sai nếu giá về dưới 20.000 đồng"], detail: "dự báo lợi nhuận 2027 sẽ đạt 15.000 tỷ" },
      [],
    )
    expect(w.map((x) => x.field)).toEqual(["conditions.0", "detail"])
    expect(draftWarnings("decision", { action: "Mua", reason: "giá mục tiêu 32k", basis: "none" }, [])).toMatchObject([
      { kind: "figure", field: "reason" },
    ])
    expect(draftWarnings("constraint", { kind: "constraint", text: "Bán khi giá 30.000 đồng" }, [])).toMatchObject([
      { kind: "figure" },
    ])
  })
})

describe("draftWarnings: duplicates", () => {
  test("a constraint equal after folding case, spaces and diacritics", () => {
    const w = draftWarnings("constraint", { kind: "constraint", text: "  không   dùng margin, kể cả t+0 " }, EXISTING)
    expect(w).toEqual([
      { kind: "duplicate", field: "text", message: "Trùng ràng buộc #1.", duplicateOf: { group: "constraint", id: 1 } },
    ])
    expect(draftWarnings("constraint", { kind: "style", text: "Trả lời ngắn, có bảng" }, EXISTING)[0]!.message).toBe(
      "Trùng cách trình bày #2.",
    )
  })

  test("a lesson title against lessons and constraints, and the other way round", () => {
    expect(draftWarnings("lesson", lessonDraft("định giá NGÂN HÀNG"), EXISTING)).toEqual([
      {
        kind: "duplicate",
        field: "title",
        message: "Trùng tiêu đề bài học #7. Sửa #7 trong /memory thay vì tạo mới?",
        duplicateOf: { group: "lesson", id: 7 },
      },
    ])
    expect(kinds(draftWarnings("lesson", lessonDraft("Tối đa 20% danh mục cho một mã"), EXISTING))).toEqual([
      "hard_rule",
      "duplicate",
    ])
    const crossed = draftWarnings("lesson", lessonDraft("Không dùng margin, kể cả T+0"), EXISTING)
    expect(crossed.find((w) => w.kind === "duplicate")?.message).toBe("Trùng ràng buộc #1.")
    expect(draftWarnings("constraint", { kind: "constraint", text: "Định giá ngân hàng" }, EXISTING)[0]!.message).toBe(
      "Trùng tiêu đề bài học #7.",
    )
  })

  test("the entry being edited is not its own duplicate", () => {
    const w = draftWarnings("constraint", { kind: "constraint", text: "Không dùng margin, kể cả T+0" }, EXISTING, {
      group: "constraint",
      id: 1,
    })
    expect(w).toEqual([])
  })
})

describe("guessKind: an unknown 'applies to' name", () => {
  test.each(["fpt", "FPT", "hpg", "VN30", "FUEVFVND".slice(0, 5)])("«%s» is a ticker", (name) => {
    expect(guessKind(name)).toBe("ticker")
  })
  test.each(["vn30", "Thép", "Ngân hàng", "Bất động sản", "abcde", "FUEVFVND", "ab", "Ép"])("«%s» is a sector", (name) => {
    expect(guessKind(name)).toBe("sector")
  })
})

describe("draftWarnings: a thesis too long to be injected", () => {
  const thesis = (text: string, conditions: string[] = []) => ({ text, conditions })
  const longOf = (d: ReturnType<typeof thesis>) => draftWarnings("thesis", d, []).filter((w) => w.kind === "too_long")

  test("a short thesis: no warning", () => {
    expect(longOf(thesis("Hưởng lợi từ đầu tư công", ["biên gộp dưới 10%"]))).toEqual([])
  })

  test("longer than the small tier's budget only: says small models get a pointer", () => {
    const [w] = longOf(thesis("t".repeat(350), Array.from({ length: 8 }, () => "c".repeat(160))))
    expect(w?.field).toBe("text")
    expect(w?.message).toContain("model nhỏ")
  })

  test("longer than every tier's budget: says no model gets it injected", () => {
    const [w] = longOf(thesis("t".repeat(2_000), Array.from({ length: 12 }, () => "c".repeat(200))))
    expect(w?.message).toContain("mọi model")
  })
})
