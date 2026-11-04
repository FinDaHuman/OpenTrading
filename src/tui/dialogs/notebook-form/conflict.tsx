import { For } from "solid-js"
import type { FieldChange } from "../../../core/memory/notebook/form-model"
import { color } from "../../theme"
import type { FormStep } from "./frame"

/**
 * Field-by-field differences, shown before an edit is saved (against the version the form read) and on a
 * conflict (the version saved elsewhere against the user's). Only fields that differ are listed; nothing
 * the user typed is lost while these screens are up, the draft stays in the form.
 */

const LABEL_WIDTH = 14

export function ChangeList(props: { changes: readonly FieldChange[]; before: string; after: string }) {
  const line = (label: string, side: string, value: string) =>
    `${label.padEnd(LABEL_WIDTH)}${side}: ${value === "" ? "(trống)" : value}`
  return (
    <For each={props.changes}>
      {(c) => (
        <box flexDirection="column">
          <text fg={color.tx2} wrapMode="word">
            {line(c.label, props.before, c.before)}
          </text>
          <text fg={color.tx} wrapMode="word">
            {line("", props.after, c.after)}
          </text>
        </box>
      )}
    </For>
  )
}

/** Before an edit is saved: what changes against the version the form opened on. */
export function reviewStep(version: number, changes: readonly FieldChange[], save: () => void): FormStep {
  return {
    title: `Chỗ khác nhau so với bản ${version}:`,
    body: () => <ChangeList changes={changes} before={`bản ${version}`} after="bản mới" />,
    choices: [{ label: "Xác nhận lưu", run: save }, { label: "Sửa tiếp" }],
  }
}

/** The store refused the edit: someone saved version `version` meanwhile. Nothing was written. */
export function conflictStep(
  version: number,
  changes: readonly FieldChange[],
  on: { keepMine: () => void; takeTheirs: () => void },
): FormStep {
  return {
    title: `Mục này vừa được sửa ở nơi khác (đang là bản ${version}).`,
    accent: color.tham,
    body: () => <ChangeList changes={changes} before={`bản ${version}`} after="của bạn" />,
    choices: [
      { label: `Lưu bản của tôi thành bản ${version + 1}`, run: on.keepMine },
      { label: `Bỏ bản của tôi, xem bản ${version}`, run: on.takeTheirs },
      { label: "Sửa tiếp" },
    ],
  }
}

/** The entry was deleted elsewhere while the form was open. */
export function deletedStep(what: string, saveNew: () => void): FormStep {
  return {
    title: "Mục này đã bị xoá ở nơi khác.",
    accent: color.tham,
    choices: [{ label: `Lưu thành ${what} mới`, run: saveNew }, { label: "Huỷ" }],
  }
}
